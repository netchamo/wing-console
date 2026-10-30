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
            5 -> { val n = u16(); val it = JSONArray(); val li = JSONArray(); repeat(n) { it.put(str(u8())); li.put(str(u8())) }; o.put("i", it); o.put("li", li) }
            6 -> { val n = u16(); val it = JSONArray(); val li = JSONArray(); repeat(n) { it.put(java.lang.Float.intBitsToFloat(i32()).toDouble()); li.put(str(u8())) }; o.put("i", it); o.put("li", li) }
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

    fun isOpen() = nout != null

    /** Writes raw native-protocol bytes on the open TCP link. Returns false when the link is not open. */
    fun write(bytes: ByteArray): Boolean {
        val o = nout ?: return false
        return try { synchronized(wlock) { o.write(bytes); o.flush() }; true } catch (_: Exception) { false }
    }

    /** netFor: returns the local network that reaches the mixer right now (null = none yet). */
    fun start(ip: String, netFor: () -> Network?) {
        stop()
        running = true
        thread(name = "wing-meters") { run(ip, netFor) }
    }

    fun stop() {
        running = false
        nout = null
        runCatching { tcp?.close() }
        runCatching { udp?.close() }
        tcp = null; udp = null
    }

    private fun b(v: Int) = (v and 0xff).toByte()

    private fun request(out: OutputStream, id: Int, port: Int, groups: List<Pair<Int, Int>>) {
        val buf = ArrayList<Byte>()
        listOf(0xdf, 0xd3, 0xd3, port shr 8, port, 0xd4, id shr 8, id, port shr 8, port, 0xdc).forEach { buf.add(b(it)) }
        for ((g, n) in groups) { buf.add(b(g)); buf.add(b(n)) }
        listOf(0xde, 0xdf, 0xd1).forEach { buf.add(b(it)) }
        synchronized(wlock) { out.write(buf.toByteArray()); out.flush() }
    }

    private fun keepAlive(out: OutputStream, id: Int, port: Int) {
        synchronized(wlock) { out.write(byteArrayOf(b(0xdf), b(0xd3), b(0xd4), b(id shr 8), b(id), b(port shr 8), b(port), b(0xdf), b(0xd1))); out.flush() }
    }

    private fun run(ip: String, netFor: () -> Network?) {
        var attempt = 0
        while (running) {
            // Never connect over mobile data: wait until a local network can reach the mixer.
            val net = netFor()
            if (net == null) { Thread.sleep(1000); continue }
            try {
                val u = DatagramSocket(null)
                u.reuseAddress = true
                u.bind(InetSocketAddress(0))
                net.bindSocket(u)
                u.soTimeout = 500
                udp = u
                val port = u.localPort

                val s = net.socketFactory.createSocket()
                s.tcpNoDelay = true
                s.connect(InetSocketAddress(ip, 2222), 3000)
                tcp = s
                val out = s.getOutputStream()
                synchronized(wlock) { out.write(byteArrayOf(b(0xdf), b(0xd1))); out.flush() }
                // The WING pushes every change made on the desk on this TCP link, at once.
                // Decode it so the screen follows the desk smoothly (instead of polling).
                thread(name = "wing-native-read") {
                    val buf = ByteArray(4096)
                    val dec = NativeDecoder(onValue) { emit(it) }
                    runCatching { val inp = s.getInputStream(); while (running) { val n = inp.read(buf); if (n < 0) break; for (k in 0 until n) dec.feed(buf[k].toInt() and 0xff) } }
                }
                request(out, 1, port, (0 until 40).map { 0xa0 to it } + (0 until 8).map { 0xa1 to it })
                request(out, 2, port, listOf(0xa3 to 0))
                nout = out
                log("sys", "native link open (TCP 2222): meters to UDP $port, changes can go this way")
                emit(JSONObject().put("type", "nativeOpen"))
                attempt = 0

                var nextKeep = System.currentTimeMillis() + 3000
                var nextData = System.currentTimeMillis() + 7000
                var lastEmit = 0L
                val chL = DoubleArray(48) { -90.0 }
                val chR = DoubleArray(48) { -90.0 }
                var mainL = -90.0
                var mainR = -90.0
                var gotFirst = false
                val buf = ByteArray(8192)
                while (running) {
                    val now = System.currentTimeMillis()
                    if (now >= nextKeep) { keepAlive(out, 1, port); keepAlive(out, 2, port); nextKeep = now + 3000 }
                    if (now >= nextData) { synchronized(wlock) { out.write(byteArrayOf(b(0xdf), b(0xd1))); out.flush() }; nextData = now + 7000 }
                    try {
                        val p = DatagramPacket(buf, buf.size)
                        u.receive(p)
                        if (p.length < 6) continue
                        val id = ((buf[0].toInt() and 0xff) shl 8) or (buf[1].toInt() and 0xff)
                        val n = (p.length - 4) / 2
                        fun v(k: Int): Double = if (k < n) ((buf[4 + 2 * k].toInt() shl 8) or (buf[5 + 2 * k].toInt() and 0xff)).toShort() / 256.0 else -90.0
                        if (id == 1) {
                            for (i in 0 until 48) { chL[i] = v(i * 8 + 2); chR[i] = v(i * 8 + 3) }
                            if (!gotFirst) { gotFirst = true; log("sys", "meters: first levels received ($n values)") }
                        } else if (id == 2) {
                            mainL = v(2); mainR = v(3)
                        }
                        if (now - lastEmit >= 50) {
                            lastEmit = now
                            // left and right separately: a stereo channel shows two different columns
                            val l = JSONArray(); val r = JSONArray()
                            for (i in 0 until 48) { l.put(Math.round(chL[i] * 10) / 10.0); r.put(Math.round(chR[i] * 10) / 10.0) }
                            emit(JSONObject().put("type", "meters").put("l", l).put("r", r)
                                .put("ml", Math.round(mainL * 10) / 10.0).put("mr", Math.round(mainR * 10) / 10.0))
                        }
                    } catch (_: SocketTimeoutException) { }
                }
            } catch (e: Exception) {
                if (running) log("err", "meters: ${e.message}")
            } finally {
                nout = null
                runCatching { tcp?.close() }
                runCatching { udp?.close() }
            }
            if (!running) break
            attempt++
            Thread.sleep(minOf(10_000L, 1000L * attempt))
        }
    }
}
