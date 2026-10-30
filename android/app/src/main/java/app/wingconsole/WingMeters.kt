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
class WingMeters(private val emit: (JSONObject) -> Unit, private val log: (String, String) -> Unit) {

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
                // The WING also sends data on this TCP link; read and discard it so it never backs up.
                thread(name = "wing-native-drain") {
                    val buf = ByteArray(4096)
                    runCatching { val inp = s.getInputStream(); while (running && inp.read(buf) >= 0) { } }
                }
                request(out, 1, port, (0 until 40).map { 0xa0 to it } + (0 until 8).map { 0xa1 to it })
                request(out, 2, port, listOf(0xa3 to 0))
                nout = out
                log("sys", "native link open (TCP 2222): meters to UDP $port, changes can go this way")
                attempt = 0

                var nextKeep = System.currentTimeMillis() + 3000
                var nextData = System.currentTimeMillis() + 7000
                var lastEmit = 0L
                val ch = DoubleArray(48) { -90.0 }
                var main = -90.0
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
                            for (i in 0 until 48) ch[i] = maxOf(v(i * 8 + 2), v(i * 8 + 3))
                            if (!gotFirst) { gotFirst = true; log("sys", "meters: first levels received ($n values)") }
                        } else if (id == 2) {
                            main = maxOf(v(2), v(3))
                        }
                        if (now - lastEmit >= 50) {
                            lastEmit = now
                            val arr = JSONArray()
                            for (x in ch) arr.put(Math.round(x * 10) / 10.0)
                            emit(JSONObject().put("type", "meters").put("ch", arr).put("main", Math.round(main * 10) / 10.0))
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
