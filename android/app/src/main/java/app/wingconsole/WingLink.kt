package app.wingconsole

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.nio.ByteBuffer
import java.util.concurrent.Executors
import kotlin.concurrent.thread

/**
 * Talks to a Behringer WING over the local network.
 *
 * READ ONLY by construction: this class can only send discovery ("WING?") and OSC
 * queries (an address with no arguments). There is no way to send a value, so the
 * mixer cannot be changed from here.
 *
 * Every socket is bound to the Wi-Fi network itself. When the Wi-Fi has no internet,
 * Android routes ordinary traffic over mobile data; without this binding the queries
 * would leave on mobile data and never reach the mixer. That is the usual reason other
 * apps "lose" the mixer after "stay connected without internet".
 */
class WingLink(ctx: Context, private val emit: (JSONObject) -> Unit) {

    private val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val wifiManager = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    private val sendQueue = Executors.newSingleThreadExecutor()

    @Volatile private var wifiNet: Network? = null
    @Volatile private var socket: DatagramSocket? = null
    @Volatile private var socketNet: Network? = null
    @Volatile private var target: InetAddress? = null
    @Volatile private var running = false

    private val netCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            wifiNet = network
            emit(JSONObject().put("type", "net").put("wifi", true))
            log("sys", "Wi-Fi network available")
        }
        override fun onLost(network: Network) {
            if (network == wifiNet) {
                wifiNet = null
                emit(JSONObject().put("type", "net").put("wifi", false))
                log("sys", "Wi-Fi network lost")
            }
        }
    }

    fun start() {
        // Match any Wi-Fi network, including one without internet (the mixer's router).
        val req = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        runCatching { cm.registerNetworkCallback(req, netCallback) }
            .onFailure { log("err", "network callback: ${it.message}") }
    }

    fun stop() {
        running = false
        runCatching { cm.unregisterNetworkCallback(netCallback) }
        closeSocket()
        sendQueue.shutdownNow()
    }

    fun wifiAvailable() = wifiNet != null

    // ------------------------------------------------------------ discovery

    fun discover(hint: String?) {
        thread(name = "wing-discover") {
            val lock = runCatching { wifiManager.createMulticastLock("wing-discover").apply { setReferenceCounted(false); acquire() } }.getOrNull()
            try {
                val s = DatagramSocket(null)
                s.reuseAddress = true
                s.bind(InetSocketAddress(0))
                wifiNet?.let { runCatching { it.bindSocket(s) } }
                s.broadcast = true
                s.soTimeout = 300
                val probe = "WING?".toByteArray(Charsets.US_ASCII)
                val targets = LinkedHashSet<InetAddress>()
                hint?.takeIf { it.isNotBlank() }?.let { h -> runCatching { InetAddress.getByName(h) }.getOrNull()?.let { targets.add(it) } }
                subnetBroadcast()?.let { targets.add(it) }
                runCatching { InetAddress.getByName("255.255.255.255") }.getOrNull()?.let { targets.add(it) }
                val seen = HashSet<String>()
                repeat(3) {
                    for (t in targets) runCatching {
                        s.send(DatagramPacket(probe, probe.size, t, DISCOVERY_PORT))
                        log("out", "WING? → ${t.hostAddress}:$DISCOVERY_PORT")
                    }
                    val until = System.currentTimeMillis() + 600
                    val buf = ByteArray(512)
                    while (System.currentTimeMillis() < until) {
                        try {
                            val p = DatagramPacket(buf, buf.size)
                            s.receive(p)
                            val txt = String(p.data, 0, p.length, Charsets.US_ASCII).trim { it <= ' ' }
                            log("in", txt)
                            if (!txt.startsWith("WING,")) continue
                            val f = txt.split(',')
                            val ip = f.getOrNull(1)?.takeIf { it.isNotBlank() } ?: p.address.hostAddress ?: continue
                            if (!seen.add(ip)) continue
                            emit(JSONObject().put("type", "found").put("ip", ip)
                                .put("name", f.getOrNull(2) ?: "").put("model", f.getOrNull(3) ?: "")
                                .put("serial", f.getOrNull(4) ?: "").put("fw", f.getOrNull(5) ?: ""))
                        } catch (_: SocketTimeoutException) { }
                    }
                }
                s.close()
                emit(JSONObject().put("type", "discoverDone").put("count", seen.size))
            } catch (e: Exception) {
                log("err", "discovery: ${e.message}")
                emit(JSONObject().put("type", "discoverDone").put("count", 0))
            } finally {
                runCatching { lock?.release() }
            }
        }
    }

    private fun subnetBroadcast(): InetAddress? {
        val net = wifiNet ?: return null
        val lp: LinkProperties = cm.getLinkProperties(net) ?: return null
        for (la in lp.linkAddresses) {
            val a = la.address as? Inet4Address ?: continue
            val prefix = la.prefixLength
            val ip = ByteBuffer.wrap(a.address).int
            val mask = if (prefix == 0) 0 else (-1 shl (32 - prefix))
            val bc = (ip and mask) or mask.inv()
            return InetAddress.getByAddress(ByteBuffer.allocate(4).putInt(bc).array())
        }
        return null
    }

    // ------------------------------------------------------------ OSC (queries only)

    fun connect(ip: String) {
        target = runCatching { InetAddress.getByName(ip) }.getOrNull()
        if (target == null) { status("error", "Bad address: $ip"); return }
        closeSocket()
        running = true
        status("connecting", ip)
        thread(name = "wing-rx") { receiveLoop() }
    }

    fun disconnect() {
        running = false
        target = null
        closeSocket()
        status("idle", "")
    }

    /** Ask for the current value of each address (one per line). Never sends a value. */
    fun query(addresses: String) {
        val t = target ?: return
        sendQueue.execute {
            val s = ensureSocket() ?: return@execute
            for (a in addresses.split('\n')) {
                val addr = a.trim()
                if (!addr.startsWith("/") || addr.length > 120) continue
                val bytes = oscString(addr)
                runCatching { s.send(DatagramPacket(bytes, bytes.size, t, OSC_PORT)) }
                    .onFailure { log("err", "send: ${it.message}") }
            }
        }
    }

    /** Re-creates the socket when Wi-Fi changed, so the link follows the phone between networks. */
    @Synchronized
    private fun ensureSocket(): DatagramSocket? {
        val net = wifiNet
        val cur = socket
        if (cur != null && !cur.isClosed && socketNet == net) return cur
        runCatching { cur?.close() }
        return try {
            val s = DatagramSocket(null)
            s.reuseAddress = true
            s.bind(InetSocketAddress(0))
            if (net != null) net.bindSocket(s)
            s.soTimeout = 500
            socket = s; socketNet = net
            log("sys", if (net != null) "socket bound to Wi-Fi (local port ${s.localPort})" else "socket on default network: Wi-Fi not found")
            s
        } catch (e: Exception) {
            log("err", "socket: ${e.message}")
            null
        }
    }

    @Synchronized
    private fun closeSocket() {
        runCatching { socket?.close() }
        socket = null; socketNet = null
    }

    private fun receiveLoop() {
        val buf = ByteArray(4096)
        while (running) {
            val s = ensureSocket()
            if (s == null) { Thread.sleep(500); continue }
            try {
                val p = DatagramPacket(buf, buf.size)
                s.receive(p)
                val msg = parseOsc(p.data, p.length)
                if (msg != null) emit(msg) else log("in", "unparsed ${p.length} bytes")
            } catch (_: SocketTimeoutException) {
            } catch (e: Exception) {
                if (running) { log("err", "receive: ${e.message}"); Thread.sleep(300) }
            }
        }
    }

    // ------------------------------------------------------------ OSC encoding / decoding

    private fun oscString(s: String): ByteArray {
        val out = ByteArrayOutputStream()
        val b = s.toByteArray(Charsets.UTF_8)
        out.write(b)
        val pad = 4 - (b.size % 4)
        repeat(pad) { out.write(0) }
        return out.toByteArray()
    }

    private fun readString(d: ByteArray, start: Int, len: Int): Pair<String, Int> {
        var e = start
        while (e < len && d[e] != 0.toByte()) e++
        val s = String(d, start, e - start, Charsets.UTF_8)
        val next = ((e - start) / 4 + 1) * 4 + start
        return s to next
    }

    private fun parseOsc(d: ByteArray, len: Int): JSONObject? {
        if (len < 4 || d[0] != '/'.code.toByte()) return null
        val (addr, p1) = readString(d, 0, len)
        val args = JSONArray()
        if (p1 < len && d[p1] == ','.code.toByte()) {
            val (tags, p2) = readString(d, p1, len)
            var p = p2
            for (t in tags.drop(1)) {
                when (t) {
                    's' -> { val (v, n) = readString(d, p, len); args.put(v); p = n }
                    'f' -> { if (p + 4 > len) break; args.put(ByteBuffer.wrap(d, p, 4).float.toDouble()); p += 4 }
                    'i' -> { if (p + 4 > len) break; args.put(ByteBuffer.wrap(d, p, 4).int); p += 4 }
                    else -> break
                }
            }
        }
        return JSONObject().put("type", "osc").put("address", addr).put("args", args)
    }

    private fun status(s: String, detail: String) =
        emit(JSONObject().put("type", "status").put("status", s).put("detail", detail))

    private fun log(dir: String, text: String) =
        emit(JSONObject().put("type", "log").put("dir", dir).put("text", text))

    companion object {
        const val DISCOVERY_PORT = 2222
        const val OSC_PORT = 2223
    }
}
