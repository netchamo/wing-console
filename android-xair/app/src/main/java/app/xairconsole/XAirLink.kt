package app.xairconsole

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import kotlin.concurrent.thread

/**
 * A plain UDP pipe between the page and a Behringer X-Air mixer (OSC, port 10024).
 *
 * The page builds and reads the OSC bytes itself, so protocol fixes arrive as a web update.
 * This side only moves packets, and it is the second lock of read-only mode: while live
 * control is off, every packet that carries a value is dropped here (questions – an address
 * with no arguments – and meter subscriptions pass). Live control is switched off again
 * whenever the page starts.
 *
 * Every socket is bound to one local network. When the Wi-Fi has no internet (the mixer's own
 * access point), Android routes ordinary traffic over mobile data; without this binding the
 * packets would leave on mobile data and never reach the mixer.
 */
class XAirLink(ctx: Context, private val emit: (JSONObject) -> Unit) {

    private val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val wifiManager = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    private val sendQueue = Executors.newSingleThreadExecutor()

    @Volatile private var wifiNet: Network? = null
    @Volatile private var running = true
    @Volatile private var live = false
    @Volatile private var pinned: Network? = null
    @Volatile private var lastErrAt = 0L
    private var lock: WifiManager.MulticastLock? = null

    /** One socket per local network, each with its own receive thread. */
    private class Sock(val net: Network, val s: DatagramSocket)
    private val socks = ConcurrentHashMap<Network, Sock>()

    private val netCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            wifiNet = network
            pinIfLocalOnly(network)
            emit(JSONObject().put("type", "net").put("wifi", true))
            log("sys", "Wi-Fi network available: " + wifiAddress())
        }
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
            if (network == wifiNet) pinIfLocalOnly(network)
        }
        override fun onLost(network: Network) {
            if (network == wifiNet) wifiNet = null
            if (network == pinned) { runCatching { cm.bindProcessToNetwork(null) }; pinned = null }
            socks.remove(network)?.let { runCatching { it.s.close() } }
            emit(JSONObject().put("type", "net").put("wifi", localIfaces().isNotEmpty()))
            log("sys", "a network went away; local networks now: " + wifiAddress().ifEmpty { "none" })
        }
    }

    /** When the Wi-Fi has no internet, pin the whole app to it; unpin once it has internet. */
    private fun pinIfLocalOnly(network: Network) {
        val caps = cm.getNetworkCapabilities(network) ?: return
        val validated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        if (!validated && pinned != network) {
            if (runCatching { cm.bindProcessToNetwork(network) }.getOrDefault(false)) { pinned = network; log("sys", "Wi-Fi has no internet: app pinned to it (" + wifiAddress() + ")") }
            else log("err", "could not pin the app to the Wi-Fi")
        } else if (validated && pinned == network) {
            runCatching { cm.bindProcessToNetwork(null) }; pinned = null; log("sys", "Wi-Fi has internet: app unpinned")
        }
    }

    fun start() {
        // Match any Wi-Fi network, including one without internet (the mixer's own access point).
        val req = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        // requestNetwork (not just listening): Android then keeps a Wi-Fi without internet up and usable.
        runCatching { cm.requestNetwork(req, netCallback) }
            .onFailure {
                log("err", "network request: ${it.message}; listening only")
                runCatching { cm.registerNetworkCallback(req, netCallback) }.onFailure { e -> log("err", "network callback: ${e.message}") }
            }
        lock = runCatching { wifiManager.createMulticastLock("xair").apply { setReferenceCounted(false); acquire() } }.getOrNull()
    }

    fun stop() {
        running = false
        live = false
        runCatching { cm.unregisterNetworkCallback(netCallback) }
        if (pinned != null) { runCatching { cm.bindProcessToNetwork(null) }; pinned = null }
        closeAll()
        runCatching { lock?.release() }
        sendQueue.shutdownNow()
    }

    // ------------------------------------------------------------ local networks

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
    private fun gatewayOf(i: Iface): InetAddress? =
        cm.getLinkProperties(i.net)?.routes?.firstOrNull { it.isDefaultRoute && it.gateway is Inet4Address }?.gateway

    /** The local network that can reach this address. Never mobile data. */
    private fun netFor(t: InetAddress): Network? {
        val ifs = localIfaces()
        return ifs.firstOrNull { contains(it, t) }?.net ?: wifiNet ?: ifs.firstOrNull()?.net
    }

    fun wifiAvailable() = localIfaces().isNotEmpty()

    /** Each local network: address, router, whether Android found internet on it, and whether the app is pinned to it. */
    fun netInfo(): String {
        val arr = JSONArray()
        for (i in localIfaces()) {
            val caps = cm.getNetworkCapabilities(i.net)
            arr.put(JSONObject().put("kind", i.kind).put("addr", i.addr.hostAddress).put("prefix", i.prefix).put("gw", gatewayOf(i)?.hostAddress ?: "")
                .put("internet", caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true)
                .put("pinned", i.net == pinned))
        }
        return arr.toString()
    }

    /** Every local address of this device, e.g. "192.168.1.23/24"; "" when none. */
    fun wifiAddress(): String = localIfaces().joinToString(", ") { "${it.addr.hostAddress}/${it.prefix}" }

    // ------------------------------------------------------------ sockets

    private fun sockFor(net: Network): Sock? {
        val cur = socks[net]
        if (cur != null && !cur.s.isClosed) return cur
        return try {
            val s = DatagramSocket(null)
            s.reuseAddress = true
            s.bind(InetSocketAddress(0))
            net.bindSocket(s)
            s.broadcast = true
            s.soTimeout = 1000
            val k = Sock(net, s)
            socks[net] = k
            thread(name = "xair-rx", isDaemon = true) { receiveLoop(k) }
            val local = localIfaces().firstOrNull { it.net == net }?.let { "${it.kind} ${it.addr.hostAddress}/${it.prefix}" } ?: "?"
            log("sys", "socket open on $local")
            k
        } catch (e: Exception) {
            log("err", "socket: ${e.message}")
            null
        }
    }

    private fun closeAll() {
        for (k in socks.values) runCatching { k.s.close() }
        socks.clear()
    }

    private fun receiveLoop(k: Sock) {
        val buf = ByteArray(8192)
        while (running && !k.s.isClosed) {
            try {
                val p = DatagramPacket(buf, buf.size)
                k.s.receive(p)
                emit(JSONObject().put("type", "rx").put("ip", p.address?.hostAddress ?: "")
                    .put("d", Base64.encodeToString(p.data, 0, p.length, Base64.NO_WRAP)))
            } catch (_: SocketTimeoutException) {
            } catch (e: Exception) {
                // a socket closed by a network change throws here; the next send opens a new one
                if (running && !k.s.isClosed) log("err", "receive: ${e.message}")
                runCatching { k.s.close() }
                socks.remove(k.net, k)
                return
            }
        }
    }

    private fun sendFailed(e: Throwable) {
        closeAll()
        val now = System.currentTimeMillis()
        if (now - lastErrAt > 2000) { lastErrAt = now; log("err", "send: ${e.message} (re-binding to the network)") }
    }

    // ------------------------------------------------------------ the read-only lock

    private fun addressOf(d: ByteArray): String {
        var e = 0
        while (e < d.size && d[e] != 0.toByte()) e++
        return String(d, 0, e, Charsets.US_ASCII)
    }

    /** True when the packet cannot change anything on the mixer: no arguments, or a subscription. */
    private fun readOnlySafe(d: ByteArray): Boolean {
        val addr = addressOf(d)
        if (!addr.startsWith("/")) return false
        if (SUBSCRIPTIONS.any { addr == it }) return true
        val p = (addr.length + 4) and 3.inv()
        if (p >= d.size) return true                      // no type tags at all: a question
        if (d[p] != ','.code.toByte()) return false       // unknown shape: treat as a value
        return p + 1 >= d.size || d[p + 1] == 0.toByte()  // "," alone: no arguments
    }

    fun setLive(on: Boolean) {
        if (live != on) log("sys", if (on) "live control ON: values may be sent" else "live control off: read only")
        live = on
    }

    // ------------------------------------------------------------ sending

    /** Sends one OSC packet (base64) to the mixer. Dropped when it carries a value and live control is off. */
    fun send(ip: String, b64: String) {
        val data = try { Base64.decode(b64, Base64.DEFAULT) } catch (e: Exception) { return }
        if (data.isEmpty()) return
        if (!live && !readOnlySafe(data)) { log("err", "blocked while read only: " + addressOf(data)); return }
        sendQueue.execute {
            try {
                val t = InetAddress.getByName(ip)
                val net = netFor(t)
                if (net == null) { noNet(); return@execute }
                val k = sockFor(net) ?: return@execute
                k.s.send(DatagramPacket(data, data.size, t, PORT))
            } catch (e: Exception) {
                sendFailed(e)
            }
        }
    }

    /** Sends a question (never a value) to every local network: the last known address, the router and the broadcast addresses. */
    fun discover(b64: String, hint: String?) {
        val data = try { Base64.decode(b64, Base64.DEFAULT) } catch (e: Exception) { return }
        if (data.isEmpty() || !readOnlySafe(data)) return
        sendQueue.execute {
            try {
                val ifs = localIfaces()
                if (ifs.isEmpty()) { noNet(); return@execute }
                val hintAddr = hint?.takeIf { it.isNotBlank() }?.let { runCatching { InetAddress.getByName(it) }.getOrNull() }
                for (i in ifs) {
                    val k = sockFor(i.net) ?: continue
                    val targets = LinkedHashSet<InetAddress>()
                    if (hintAddr != null) targets.add(hintAddr)
                    gatewayOf(i)?.let { targets.add(it) }     // on the mixer's own access point the mixer is the router
                    targets.add(broadcastOf(i))
                    runCatching { InetAddress.getByName("255.255.255.255") }.getOrNull()?.let { targets.add(it) }
                    for (t in targets) runCatching { k.s.send(DatagramPacket(data, data.size, t, PORT)) }
                }
            } catch (e: Exception) {
                sendFailed(e)
            }
        }
    }

    private fun noNet() {
        val now = System.currentTimeMillis()
        if (now - lastErrAt > 5000) { lastErrAt = now; log("err", "no local network (Wi-Fi off?)") }
    }

    private fun log(dir: String, text: String) =
        emit(JSONObject().put("type", "log").put("dir", dir).put("text", text))

    companion object {
        const val PORT = 10024
        val SUBSCRIPTIONS = listOf("/meters", "/subscribe", "/renew", "/unsubscribe", "/batchsubscribe", "/formatsubscribe")
    }
}
