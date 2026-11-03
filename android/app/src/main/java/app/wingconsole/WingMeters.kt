package app.wingconsole

import android.net.Network
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import kotlin.concurrent.thread

/**
 * Real meter levels from the WING, over its native protocol (the one Behringer's own apps use).
 *
 * Opens TCP 2222, asks for meter streams and keeps them alive; the WING sends the levels as UDP
 * packets to a local port we announce. write() lets WingLink send a change on the same link, but
 * WingLink only does that while live control is on.
 *
 * Byte layout follows libwing (github.com/dannyfiresnake/libwing, console.rs):
 *   keep-alive (data)   DF D1                                  every 7 s
 *   meter request       DF D3 D3 pp pp D4 ii ii pp pp DC {group n}* DE DF D1
 *   meter keep-alive    DF D3 D4 ii ii pp pp DF D1             every 3 s per request id
 *   UDP packet          ii ii xx xx then big-endian int16 values, 8 per strip,
 *                       values [2] and [3] are the strip's L/R level in 1/256 dB
 * Groups: A0 channel (0-based), A1 aux, A3 main.
 */
/**
 * Decodes the WING native data stream (layout from libwing console.rs read()/decode_next()).
 * DF is the escape byte: DF DE = literal DF, DF D0..DD = switch channel. Then commands:
 * D7 id(4) selects a parameter, and the value that follows belongs to it:
 * 00-3F small int, D3 int16, D4 int32, D5/D6 float, 80-CF / D0 / D1 strings.
 */
class NativeDecoder(private val onValue: (id: Int, kind: String, num: Double, str: String?) -> Unit,
                    private val onDef: (JSONObject) -> Unit = {}) {
    private var defPhase = 0          // 1: reading u16 length, 2: reading u32 length, 3: collecting the definition
    private var defNeed = 0
    private var defAcc = 0L
    private var defBuf = java.io.ByteArrayOutputStream()
    private var esc = false
    private var channel = -1
    private var id = 0
    private var cmd = -1
    private var need = 0
    private var acc = 0L
    private var str: StringBuilder? = null
    private var skip = 0
    private var defLen = -1

    fun feed(x: Int) {
        if (!esc) { if (x == 0xdf) esc = true else token(x); return }
        if (x == 0xdf) { token(0xdf); return }
        esc = false
        when {
            x == 0xde -> token(0xdf)
            x in 0xd0..0xdd -> channel = x - 0xd0
            channel >= 0 -> { token(0xdf); token(x) }
            else -> token(x)
        }
    }

    private fun token(t: Int) {
        if (defPhase > 0) { defToken(t); return }
        if (skip > 0) { skip--; return }
        if (need > 0) {
            if (str != null) str!!.append(t.toChar()) else acc = (acc shl 8) or t.toLong()
            need--
            if (need == 0) finish()
            return
        }
        cmd = t
        acc = 0; str = null
        when {
            t <= 0x3f -> onValue(id, "i", t.toDouble(), null)
            t in 0x80..0xcf -> { str = StringBuilder(); need = if (t <= 0xbf) t - 0x7f else t - 0xbf }
            t == 0xd0 -> onValue(id, "s", 0.0, "")
            t == 0xd1 -> { need = 1 }
            t == 0xd2 || t == 0xd3 -> need = 2
            t == 0xd4 || t == 0xd5 || t == 0xd6 || t == 0xd7 -> need = 4
            t == 0xd9 -> skip = 1
            t == 0xdf -> { defPhase = 1; defNeed = 2; defAcc = 0 }
        }
    }

    /* node definition (libwing node.rs from_bytes): DF len16 [len32 if 0] then the definition bytes */
    private fun defToken(t: Int) {
        when (defPhase) {
            1, 2 -> { defAcc = (defAcc shl 8) or t.toLong(); defNeed--
                if (defNeed == 0) {
                    if (defPhase == 1 && defAcc == 0L) { defPhase = 2; defNeed = 4; defAcc = 0; return }
                    defNeed = defAcc.toInt(); defBuf = java.io.ByteArrayOutputStream()
                    defPhase = if (defNeed > 0) 3 else 0
                } }
            3 -> { defBuf.write(t); defNeed--; if (defNeed <= 0) { defPhase = 0; runCatching { onDef(parseDef(defBuf.toByteArray())) } } }
        }
    }

    private fun parseDef(r: ByteArray): JSONObject {
        var i = 0
        fun u8() = r[i++].toInt() and 0xff
        fun u16() = (u8() shl 8) or u8()
        fun i32() = (u8() shl 24) or (u8() shl 16) or (u8() shl 8) or u8()
        fun str(n: Int): String { val s = String(r, i, n, Charsets.UTF_8); i += n; return s }
        val o = JSONObject().put("type", "def")
        o.put("parent", i32()); o.put("id", i32()); o.put("index", u16())
        o.put("name", str(u8())); o.put("lname", str(u8()))
        val flags = u16()
        val t = (flags shr 4) and 0x0f
        o.put("t", arrayOf("node", "lin", "log", "fdr", "int", "enum", "fenum", "str").getOrElse(t) { "node" })
        o.put("u", flags and 0x0f); o.put("ro", (flags shr 9) and 1)
        when (t) {
            1, 2 -> { o.put("a", java.lang.Float.intBitsToFloat(i32()).toDouble()); o.put("b", java.lang.Float.intBitsToFloat(i32()).toDouble()); o.put("n", i32()) }
            4 -> { o.put("a", i32()); o.put("b", i32()) }
            5 -> { val n = u16(); val items = JSONArray(); val li = JSONArray(); repeat(n) { items.put(str(u8())); li.put(str(u8())) }; o.put("i", items); o.put("li", li) }
            6 -> { val n = u16(); val items = JSONArray(); val li = JSONArray(); repeat(n) { items.put(java.lang.Float.intBitsToFloat(i32()).toDouble()); li.put(str(u8())) }; o.put("i", items); o.put("li", li) }
        }
        return o
    }

    private fun finish() {
        val c = cmd
        when (c) {
            0xd1 -> if (str == null) { str = StringBuilder(); cmd = 0x80; need = acc.toInt() + 1; return }
            0xd2 -> {}
            0xd3 -> onValue(id, "i", acc.toInt().toShort().toDouble(), null)
            0xd4 -> onValue(id, "i", acc.toInt().toDouble(), null)
            0xd5, 0xd6 -> onValue(id, if (c == 0xd5) "f" else "r", java.lang.Float.intBitsToFloat(acc.toInt()).toDouble(), null)
            0xd7 -> id = acc.toInt()
            else -> if (str != null) onValue(id, "s", 0.0, str.toString())
        }
        str = null
    }
}

class WingMeters(private val emit: (JSONObject) -> Unit, private val log: (String, String) -> Unit,
                 private val onValue: (Int, String, Double, String?) -> Unit = { _, _, _, _ -> }) {

    @Volatile private var running = false
    @Volatile private var tcp: Socket? = null
    @Volatile private var udp: DatagramSocket? = null
    @Volatile private var nout: OutputStream? = null
    private val wlock = Any()

    fun isOpen() = running && nout != null

    /** Writes raw native-protocol bytes on the open TCP link. Returns false when the link is not open. */
    fun write(bytes: ByteArray): Boolean {
        val o = nout ?: return false
        return try { synchronized(wlock) { o.write(bytes); o.flush() }; true } catch (_: Exception) { false }
    }

    /** netFor: returns the local network that reaches the mixer right now (null = none yet). */
    /** each start gets its own generation: an older loop still unwinding stops itself and never touches the new link */
    @Volatile private var gen = 0
    fun start(ip: String, netFor: () -> Network?) {
        stop()
        running = true
        val my = gen
        thread(name = "wing-meters") { run(ip, netFor, my) }
    }

    fun stop() {
        gen++
        running = false
        nout = null
        runCatching { tcp?.close() }
        runCatching { udp?.close() }
        tcp = null; udp = null
    }

    private fun b(v: Int) = (v and 0xff).toByte()

    /** a value byte equal to 0xdf is sent as 0xdf 0xde, so the desk does not read it as a command */
    private fun esc(buf: ArrayList<Byte>, vararg v: Int) { for (x in v) { buf.add(b(x)); if ((x and 0xff) == 0xdf) buf.add(b(0xde)) } }

    /** Behringer, WING Remote Protocols 3.1, "Channel 3: Metering": set the UDP port, give a 4-byte report id,
     *  then one collection (type, indexes...); the desk sends it all in one packet and stops after 5 s unless
     *  the same report id is sent again. One collection only: the desk keeps just the last one sent. */
    private val REPORT = 1
    private fun requestMeters(out: OutputStream, port: Int) {
        val buf = ArrayList<Byte>()
        buf.add(b(0xdf)); buf.add(b(0xd3)); buf.add(b(0xd3)); esc(buf, port shr 8, port)
        buf.add(b(0xd4)); esc(buf, REPORT ushr 24, REPORT shr 16, REPORT shr 8, REPORT)
        buf.add(b(0xdc))
        buf.add(b(0xa0)); for (i in 0 until 40) buf.add(b(i))     // channels 1..40
        buf.add(b(0xa1)); for (i in 0 until 8) buf.add(b(i))      // aux 1..8
        buf.add(b(0xa3)); for (i in 0 until 4) buf.add(b(i))      // mains 1..4
        buf.add(b(0xa2)); for (i in 0 until 16) buf.add(b(i))     // buses 1..16
        buf.add(b(0xa4)); for (i in 0 until 8) buf.add(b(i))      // matrices 1..8
        buf.add(b(0xde)); buf.add(b(0xdf)); buf.add(b(0xd1))
        synchronized(wlock) { out.write(buf.toByteArray()); out.flush() }
    }
    private fun renewMeters(out: OutputStream) {
        val buf = ArrayList<Byte>(); buf.add(b(0xdf)); buf.add(b(0xd3)); buf.add(b(0xd4)); esc(buf, REPORT ushr 24, REPORT shr 16, REPORT shr 8, REPORT); buf.add(b(0xdf)); buf.add(b(0xd1))
        synchronized(wlock) { out.write(buf.toByteArray()); out.flush() }
    }
    /** The desk closes a link with no data exchange for 10 s: ask for one real value (channel 1 fader). */
    private val PING_ID = 950957506
    private fun ping(out: OutputStream) {
        val buf = ArrayList<Byte>(); buf.add(b(0xdf)); buf.add(b(0xd1)); buf.add(b(0xd7)); esc(buf, PING_ID ushr 24, PING_ID shr 16, PING_ID shr 8, PING_ID); buf.add(b(0xdc))
        synchronized(wlock) { out.write(buf.toByteArray()); out.flush() }
    }

    private fun run(ip: String, netFor: () -> Network?, my: Int) {
        val alive = { running && gen == my }
        var attempt = 0
        var u0: DatagramSocket? = null
        var s0: java.net.Socket? = null
        while (alive()) {
            // Never connect over mobile data: wait until a local network can reach the mixer.
            val net = netFor()
            if (net == null) { Thread.sleep(1000); continue }
            try {
                val u = DatagramSocket(null)
                u.reuseAddress = true
                u.bind(InetSocketAddress(0))
                net.bindSocket(u)
                u.soTimeout = 500
                udp = u; u0 = u
                val port = u.localPort
                // Our own meter ids: another app on the desk (Mixing Station, WING Edit) uses 1, 2, 3 too, and the desk
                // would send our levels to it instead. A random range keeps the two apart.

                val s = net.socketFactory.createSocket()
                s.tcpNoDelay = true
                s.connect(InetSocketAddress(ip, 2222), 3000)
                tcp = s; s0 = s
                if (!alive()) throw Exception("superseded")
                val out = s.getOutputStream()
                synchronized(wlock) { out.write(byteArrayOf(b(0xdf), b(0xd1))); out.flush() }
                // The WING pushes every change made on the desk on this TCP link, at once.
                // Decode it so the screen follows the desk smoothly (instead of polling).
                thread(name = "wing-native-read") {
                    val buf = ByteArray(4096)
                    val dec = NativeDecoder(onValue) { emit(it) }
                    runCatching { val inp = s.getInputStream(); while (alive()) { val n = inp.read(buf); if (n < 0) break; for (k in 0 until n) dec.feed(buf[k].toInt() and 0xff) } }
                }
                requestMeters(out, port)
                nout = out
                log("sys", "native link open (TCP 2222): meters to UDP $port, changes can go this way")
                emit(JSONObject().put("type", "nativeOpen"))
                attempt = 0

                var nextKeep = System.currentTimeMillis() + 2500
                var nextData = System.currentTimeMillis() + 5000
                var lastEmit = 0L
                val chL = DoubleArray(48) { -90.0 }
                val chR = DoubleArray(48) { -90.0 }
                val bL = DoubleArray(24) { -90.0 }
                val bR = DoubleArray(24) { -90.0 }
                val mL = DoubleArray(4) { -90.0 }
                val mR = DoubleArray(4) { -90.0 }
                var mainL = -90.0
                var mainR = -90.0
                var gotFirst = false
                var lastPkt = System.currentTimeMillis()
                var cnt = 0
                val openedAt = System.currentTimeMillis(); var nextCnt = openedAt + 2000; var lastCntLog = 0L; var quiet = false
                val buf = ByteArray(8192)
                while (alive()) {
                    val now = System.currentTimeMillis()
                    // packets per 2 s in the log: every 2 s for the first minute, then every 30 s
                    if (now >= nextCnt) {
                        if (now - openedAt < 60000 || now - lastCntLog > 30000) { log("sys", "meters: $cnt packets in 2 s"); lastCntLog = now }
                        if (cnt == 0 && !quiet && now - lastPkt > 6000) { quiet = true; log("err", "meters: the desk stopped sending levels") }
                        cnt = 0; nextCnt = now + 2000
                    }
                    if (now >= nextKeep) { renewMeters(out); nextKeep = now + 2500 }
                    if (now >= nextData) { ping(out); nextData = now + 5000 }
                    try {
                        val p = DatagramPacket(buf, buf.size)
                        u.receive(p)
                        if (p.length < 6) continue
                        val id = ((buf[0].toInt() and 0xff) shl 24) or ((buf[1].toInt() and 0xff) shl 16) or ((buf[2].toInt() and 0xff) shl 8) or (buf[3].toInt() and 0xff)
                        if (id != REPORT) continue
                        if (quiet) { quiet = false; log("sys", "meters: levels are back") }
                        lastPkt = now; cnt++
                        val n = (p.length - 4) / 2
                        fun v(k: Int): Double = if (k < n) ((buf[4 + 2 * k].toInt() shl 8) or (buf[5 + 2 * k].toInt() and 0xff)).toShort() / 256.0 else -90.0
                        // one packet, in the order requested: 40 channels, 8 aux, 4 mains, 16 buses, 8 matrices; 8 words each
                        for (i in 0 until 48) { chL[i] = v(i * 8 + 2); chR[i] = v(i * 8 + 3) }
                        val mo = 48 * 8
                        for (k in 0 until 4) { mL[k] = v(mo + k * 8 + 2); mR[k] = v(mo + k * 8 + 3) }
                        mainL = mL[0]; mainR = mR[0]
                        val bo = mo + 4 * 8
                        for (i in 0 until 24) { bL[i] = v(bo + i * 8 + 2); bR[i] = v(bo + i * 8 + 3) }
                        if (!gotFirst) { gotFirst = true; log("sys", "meters: first levels received ($n values, expected ${80 * 8})") }
                        if (now - lastEmit >= 50) {
                            lastEmit = now
                            // left and right separately: a stereo channel shows two different columns
                            val l = JSONArray(); val r = JSONArray()
                            for (i in 0 until 48) { l.put(Math.round(chL[i] * 10) / 10.0); r.put(Math.round(chR[i] * 10) / 10.0) }
                            val ml4 = JSONArray(); val mr4 = JSONArray()
                            for (k in 0 until 4) { ml4.put(Math.round(mL[k] * 10) / 10.0); mr4.put(Math.round(mR[k] * 10) / 10.0) }
                            val bl = JSONArray(); val br = JSONArray()
                            for (i in 0 until 24) { bl.put(Math.round(bL[i] * 10) / 10.0); br.put(Math.round(bR[i] * 10) / 10.0) }
                            emit(JSONObject().put("type", "meters").put("l", l).put("r", r)
                                .put("ml", Math.round(mainL * 10) / 10.0).put("mr", Math.round(mainR * 10) / 10.0).put("bl", bl).put("br", br).put("mL", ml4).put("mR", mr4))
                        }
                    } catch (_: SocketTimeoutException) { }
                }
            } catch (e: Exception) {
                if (alive()) log("err", "meters: ${e.message}")
            } finally {
                if (gen == my) { if (nout != null) emit(JSONObject().put("type", "nativeClosed")); nout = null }
                runCatching { s0?.close() }
                runCatching { u0?.close() }
                if (tcp === s0) tcp = null
                if (udp === u0) udp = null
            }
            if (!alive()) break
            attempt++
            Thread.sleep(minOf(10_000L, 1000L * attempt))
        }
    }
}
