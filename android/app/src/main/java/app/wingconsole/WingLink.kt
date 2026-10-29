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
 * READ ONLY unless live control is on: queries (an address with no arguments) always
 * work; set() refuses to send anything until the user has turned live control on in
 * the app, and live control switches off again on every new connection.
 *
 * Every socket is bound to the local network whose address range contains the mixer. When the Wi-Fi has no internet,
 * Android routes ordinary traffic over mobile data; without this binding the queries
 * would leave on mobile data and never reach the mixer. That is the usual reason other
 * apps "lose" the mixer after "stay connected without internet".
 */
class WingLink(ctx: Context, private val emit: (JSONObject) -> Unit) {

    private val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val wifiManager = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    private val sendQueue = Executors.newSingleThreadExecutor()
    private val meters = WingMeters(emit) { d, t -> log(d, t) }

    @Volatile private var wifiNet: Network? = null
    @Volatile private var socket: DatagramSocket? = null
    @Volatile private var socketNet: Network? = null
    @Volatile private var target: InetAddress? = null
    @Volatile private var running = false
    @Volatile private var live = false
    @Volatile private var sentCount = 0
    @Volatile private var pickedNet: Network? = null
    @Volatile private var pickedAt = 0L

    private val netCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            wifiNet = network
            pickedAt = 0L
            emit(JSONObject().put("type", "net").put("wifi", true))
            log("sys", "Wi-Fi network available: " + wifiAddress())
        }
        override fun onLost(network: Network) {
            pickedAt = 0L
            if (network == wifiNet) wifiNet = null
            val any = localIfaces().isNotEmpty()
            emit(JSONObject().put("type", "net").put("wifi", any))
            log("sys", "a network went away; local networks now: " + wifiAddress().ifEmpty { "none" })
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
        meters.stop()
        running = false
        runCatching { cm.unregisterNetworkCallback(netCallback) }
        closeSocket()
        sendQueue.shutdownNow()
    }

    // ------------------------------------------------------------ local networks
    // A phone or tablet can be on more than one local network at once (two Wi-Fi links,
    // Wi-Fi Direct, a USB/Ethernet adapter). The link to the mixer must use the one whose
    // address range contains the mixer, not simply the last network Android reported.

    private class Iface(val net: Network, val addr: Inet4Address, val prefix: Int, val kind: String)

    private fun localIfaces(): List<Iface> {
        val out = ArrayList<Iface>()
        @Suppress("DEPRECATION") val nets = runCatching { cm.allNetworks }.getOrDefault(emptyArray())
        for (n in nets) {
            val caps = cm.getNetworkCapabilities(n) ?: continue
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) continue
            val kind = when {
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
                else -> continue
            }
            val lp = cm.getLinkProperties(n) ?: continue
            for (la in lp.linkAddresses) {
                val a = la.address as? Inet4Address ?: continue
                out.add(Iface(n, a, la.prefixLength, kind))
            }
        }
        return out
    }

    private fun ipInt(a: InetAddress) = ByteBuffer.wrap(a.address).int
    private fun maskOf(p: Int) = if (p <= 0) 0 else (-1 shl (32 - p))
    private fun contains(i: Iface, t: InetAddress) = t is Inet4Address &&
        (ipInt(i.addr) and maskOf(i.prefix)) == (ipInt(t) and maskOf(i.prefix))
    private fun broadcastOf(i: Iface): InetAddress =
        InetAddress.getByAddress(ByteBuffer.allocate(4).putInt((ipInt(i.addr) and maskOf(i.prefix)) or maskOf(i.prefix).inv()).array())

    /** The local network that can reach this address (cached for 2 s). */
    private fun netFor(t: InetAddress?): Network? {
        val now = System.currentTimeMillis()
        if (now - pickedAt < 2000) return pickedNet
        val ifs = localIfaces()
        val pick = (if (t != null) ifs.firstOrNull { contains(it, t) } else null)?.net ?: wifiNet ?: ifs.firstOrNull()?.net
        pickedNet = pick; pickedAt = now
        return pick
    }

    fun wifiAvailable() = localIfaces().isNotEmpty()

    /** Every local address of this device, e.g. "192.168.0.23/24, 10.87.141.5/24"; "" when none. */
    fun wifiAddress(): String = localIfaces().joinToString(", ") { "${it.addr.hostAddress}/${it.prefix}" }

    // ------------------------------------------------------------ discovery

    fun discover(hint: String?) {
        thread(name = "wing-discover") {
            val lock = runCatching { wifiManager.createMulticastLock("wing-discover").apply { setReferenceCounted(false); acquire() } }.getOrNull()
            val seen = java.util.Collections.synchronizedSet(HashSet<String>())
            try {
                val ifs = localIfaces()
                if (ifs.isEmpty()) log("err", "no local network found (Wi-Fi off?)")
                val hintAddr = hint?.takeIf { it.isNotBlank() }?.let { runCatching { InetAddress.getByName(it) }.getOrNull() }
                val workers = ifs.map { iface ->
                    thread(name = "wing-discover-${iface.addr.hostAddress}") {
                        log("sys", "searching on ${iface.kind} ${iface.addr.hostAddress}/${iface.prefix}")
                        runCatching { searchOn(iface, hintAddr, seen) }.onFailure { log("err", "search on ${iface.addr.hostAddress}: ${it.message}") }
                    }
                }
                workers.forEach { it.join() }
                emit(JSONObject().put("type", "discoverDone").put("count", seen.size))
            } catch (e: Exception) {
                log("err", "discovery: ${e.message}")
                emit(JSONObject().put("type", "discoverDone").put("count", seen.size))
            } finally {
                runCatching { lock?.release() }
            }
        }
    }

    private fun searchOn(iface: Iface, hint: InetAddress?, seen: MutableSet<String>) {
        val s = DatagramSocket(null)
        try {
            s.reuseAddress = true
            s.bind(InetSocketAddress(0))
            iface.net.bindSocket(s)
            s.broadcast = true
            s.soTimeout = 300
            val probe = "WING?".toByteArray(Charsets.US_ASCII)
            val targets = LinkedHashSet<InetAddress>()
            if (hint != null && contains(iface, hint)) targets.add(hint)
            targets.add(broadcastOf(iface))
            runCatching { InetAddress.getByName("255.255.255.255") }.getOrNull()?.let { targets.add(it) }
            val buf = ByteArray(512)
            repeat(3) {
                for (t in targets) runCatching {
                    s.send(DatagramPacket(probe, probe.size, t, DISCOVERY_PORT))
                    log("out", "WING? → ${t.hostAddress}:$DISCOVERY_PORT")
                }
                val until = System.currentTimeMillis() + 600
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
        } finally {
            s.close()
        }
    }

    // ------------------------------------------------------------ OSC (queries only)

    fun connect(ip: String) {
        live = false
        pickedAt = 0L
        target = runCatching { InetAddress.getByName(ip) }.getOrNull()
        if (target == null) { status("error", "Bad address: $ip"); return }
        closeSocket()
        running = true
        status("connecting", ip)
        thread(name = "wing-rx") { receiveLoop() }
        val t = target
        thread(name = "wing-meters-start") { meters.start(ip, netFor(t)) }
    }

    fun disconnect() {
        meters.stop()
        live = false
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

    fun setLive(on: Boolean) {
        live = on
        sentCount = 0
        log("sys", if (on) "LIVE CONTROL ON: changes are sent to the mixer" else "live control off: reading only")
    }

    /** Send one value. Refused unless live control is on. type: "f" (float), "i" (int) or "s" (string). */
    fun set(address: String, type: String, value: String) {
        if (!live) { log("err", "blocked (live control off): $address $value"); return }
        val t = target ?: return
        if (!address.startsWith("/") || address.length > 120) return
        val arg = when (type) {
            "f" -> ByteBuffer.allocate(4).putFloat(value.toFloatOrNull() ?: return).array()
            "i" -> ByteBuffer.allocate(4).putInt(value.toIntOrNull() ?: return).array()
            "s" -> oscString(value)
            else -> return
        }
        val bytes = oscString(address) + oscString(",$type") + arg
        sendQueue.execute {
            val s = ensureSocket() ?: return@execute
            runCatching { s.send(DatagramPacket(bytes, bytes.size, t, OSC_PORT)) }
                .onFailure { log("err", "send: ${it.message}") }
        }
        // a fader drag sends dozens per second: log the first one and then every 50th
        val n = ++sentCount
        if (n == 1 || n % 50 == 0) log("out", "sent #$n: $address ,$type $value (${bytes.size} bytes to ${t.hostAddress}:$OSC_PORT)")
    }

    /**
     * Send one value over the native protocol (TCP 2222), the way Behringer's apps and Mixing Station
     * do. Refused unless live control is on. id: the WING property id; type "f" or "i".
     * Encoding from libwing set_float / set_int: D7 + id (4 bytes) [+ D5 + float] or [int].
     * Any 0xDF byte in the payload is escaped as DF DE.
     */
    fun setNative(id: Int, type: String, value: String) {
        if (!live) { log("err", "blocked (live control off): id $id $value"); return }
        val buf = ByteArrayOutputStream()
        fun esc(v: Int) { val x = v and 0xff; buf.write(x); if (x == 0xdf) buf.write(0xde) }
        fun esc32(v: Int) { esc(v ushr 24); esc(v ushr 16); esc(v ushr 8); esc(v) }
        buf.write(0xd7); esc32(id)
        when (type) {
            "f" -> { buf.write(0xd5); esc32(java.lang.Float.floatToIntBits(value.toFloatOrNull() ?: return)) }
            "i" -> { val v = value.toIntOrNull() ?: return; if (v in 0..0x3f) buf.write(v) else { buf.write(0xd4); esc32(v) } }
            else -> return
        }
        if (!meters.write(buf.toByteArray())) { log("err", "native link not open, change not sent"); return }
        val n = ++sentCount
        if (n == 1 || n % 50 == 0) log("out", "native #$n: id $id ,$type $value")
    }

    fun nativeOpen() = meters.isOpen()

    /** Re-creates the socket when Wi-Fi changed, so the link follows the phone between networks. */
    @Synchronized
    private fun ensureSocket(): DatagramSocket? {
        val net = netFor(target)
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
            val local = localIfaces().firstOrNull { it.net == net }?.let { "${it.kind} ${it.addr.hostAddress}/${it.prefix}" }
            log("sys", if (net != null) "link to ${target?.hostAddress} uses $local" else "no local network reaches ${target?.hostAddress}; using the default route")
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
