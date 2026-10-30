package app.wingconsole

import android.app.Activity
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import android.net.Uri
import android.os.Environment
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Hosts the Wing Console interface and links it to the mixer: reading by default,
 * sending only after the user turns live control on.
 *
 * The interface ships inside the app (assets/index.html), so it opens with no internet,
 * for example on the mixer's own Wi-Fi. When internet is available, the newest interface
 * is downloaded from GitHub Pages and used from the next launch on.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var link: WingLink
    private val main = Handler(Looper.getMainLooper())
    private val outbox = JSONArray()
    private var flushQueued = false
    @Volatile private var jsReady = false
    private var servedDownloaded = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this)
        web.setBackgroundColor(0xFF0B0A09.toInt())
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = false
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                val url = request?.url ?: return null
                if (url.host == HOST && (url.path == "/" || url.path == "/index.html")) {
                    downloadedIndex()?.let { f ->
                        servedDownloaded = true
                        return WebResourceResponse("text/html", "utf-8", f.inputStream())
                    }
                    servedDownloaded = false
                    return assets.shouldInterceptRequest(android.net.Uri.parse("https://$HOST/index.html"))
                }
                if (url.host != HOST) {
                    // Fonts and other outside files: answer at once when there is no internet
                    // (mixer Wi-Fi), so nothing waits on the network and the screen never stays black.
                    if (!hasInternet()) return WebResourceResponse("text/plain", "utf-8", 204, "No Content", emptyMap(), java.io.ByteArrayInputStream(ByteArray(0)))
                    return null
                }
                return assets.shouldInterceptRequest(url)
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                jsReady = false
                // A downloaded interface that never starts is broken: drop it and use the built-in one.
                main.postDelayed({
                    if (!jsReady && servedDownloaded) { downloadedIndex()?.delete(); servedDownloaded = false; web.reload() }
                }, 20000)
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url ?: return false
                if (url.host == HOST) return false
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                return true
            }
        }

        link = WingLink(this) { post(it) }
        web.addJavascriptInterface(Bridge(), "WingNative")
        setContentView(web)
        goImmersive()
        link.start()
        web.loadUrl("https://$HOST/index.html")
        checkWebUpdate()
        checkApkUpdate()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) goImmersive()
    }

    override fun onDestroy() {
        updateReceiver?.let { runCatching { unregisterReceiver(it) } }
        link.stop()
        super.onDestroy()
    }

    @Suppress("DEPRECATION")
    private fun goImmersive() {
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
        }
    }

    // ------------------------------------------------------------ events → JS (batched)

    private fun post(o: JSONObject) {
        synchronized(outbox) {
            outbox.put(o)
            if (flushQueued) return
            flushQueued = true
        }
        main.postDelayed({ flush() }, 40)
    }

    private fun flush() {
        val payload: String
        synchronized(outbox) {
            payload = outbox.toString()
            while (outbox.length() > 0) outbox.remove(0)
            flushQueued = false
        }
        if (payload == "[]") return
        web.evaluateJavascript("window.__wingNative&&window.__wingNative($payload)", null)
    }

    // ------------------------------------------------------------ interface updates

    /** True only when the phone's default network really reaches the internet (validated). */
    private fun hasInternet(): Boolean = runCatching {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork ?: return false) ?: return false
        caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }.getOrDefault(false)

    private fun downloadedIndex(): File? = File(filesDir, "web/index.html").takeIf { it.isFile && it.length() > 1000 }

    private fun checkWebUpdate() {
        thread(name = "web-update") {
            try {
                val c = URL(UPDATE_URL).openConnection() as HttpURLConnection
                c.connectTimeout = 5000; c.readTimeout = 10000
                c.setRequestProperty("Cache-Control", "no-cache")
                if (c.responseCode != 200) return@thread
                var html = c.inputStream.bufferedReader().readText()
                if (!html.contains("WING CONSOLE")) return@thread
                html = html.replace(CDN_HTM, "/vendor/htm-preact.js")
                val dir = File(filesDir, "web").apply { mkdirs() }
                val f = File(dir, "index.html")
                if (f.isFile && f.readText() == html) return@thread
                File(dir, "index.tmp").apply { writeText(html); renameTo(f) }
                post(JSONObject().put("type", "update").put("ready", true))
            } catch (_: Exception) { /* no internet: keep what we have */ }
        }
    }

    // ------------------------------------------------------------ app (APK) updates

    private fun versionCode(): Long = runCatching { packageManager.getPackageInfo(packageName, 0).longVersionCode }.getOrDefault(0L)

    /** Asks GitHub which build is the latest release; tells the page when it is newer than this one. */
    private fun checkApkUpdate() {
        thread(name = "apk-update") {
            try {
                val c = URL(RELEASE_API).openConnection() as HttpURLConnection
                c.connectTimeout = 5000; c.readTimeout = 8000
                c.setRequestProperty("Accept", "application/vnd.github+json")
                c.setRequestProperty("User-Agent", "WingConsole")
                if (c.responseCode != 200) return@thread
                val body = JSONObject(c.inputStream.bufferedReader().readText()).optString("body")
                val build = Regex("Build #(\\d+)").find(body)?.groupValues?.get(1)?.toLongOrNull() ?: return@thread
                if (build > versionCode()) post(JSONObject().put("type", "apkUpdate").put("build", build).put("current", versionCode()))
            } catch (_: Exception) { /* no internet */ }
        }
    }

    @Volatile private var updateId = -1L
    private var updateReceiver: BroadcastReceiver? = null

    private fun startUpdateDownload() {
        val dm = getSystemService(DownloadManager::class.java)
        if (updateId >= 0) runCatching { dm.remove(updateId) }
        val req = DownloadManager.Request(Uri.parse(APK_URL))
            .setTitle("Wing Console")
            .setDescription("מוריד עדכון")
            .setMimeType(APK_MIME)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "wing-console-${System.currentTimeMillis()}.apk")
        updateId = dm.enqueue(req)
        if (updateReceiver == null) {
            val r = object : BroadcastReceiver() {
                override fun onReceive(context: Context, intent: Intent) {
                    val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
                    if (id == updateId) installDownloaded(id)
                }
            }
            val f = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(r, f, Context.RECEIVER_EXPORTED) else registerReceiver(r, f)
            updateReceiver = r
        }
    }

    private fun installDownloaded(id: Long) {
        val dm = getSystemService(DownloadManager::class.java)
        val uri = dm.getUriForDownloadedFile(id) ?: return
        runCatching {
            startActivity(Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, APK_MIME)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            })
        }
    }

    // ------------------------------------------------------------ bridge

    inner class Bridge {
        @JavascriptInterface fun ready() { jsReady = true }
        @JavascriptInterface fun version(): String = runCatching { packageManager.getPackageInfo(packageName, 0).versionName ?: "" }.getOrDefault("")
        @JavascriptInterface fun wifi(): Boolean = link.wifiAvailable()
        @JavascriptInterface fun wifiAddress(): String = link.wifiAddress()
        @JavascriptInterface fun discover(hint: String?) = link.discover(hint)
        @JavascriptInterface fun connect(ip: String) = link.connect(ip)
        @JavascriptInterface fun disconnect() = link.disconnect()
        /** Read-only: ask the mixer for the current value of each address (newline separated). */
        @JavascriptInterface fun query(addresses: String) = link.query(addresses)
        /** Live control: only after the user confirmed it in the app. */
        @JavascriptInterface fun setLive(on: Boolean) = link.setLive(on)
        @JavascriptInterface fun set(address: String, type: String, value: String) = link.set(address, type, value)
        @JavascriptInterface fun setNative(id: Int, type: String, value: String) = link.setNative(id, type, value)
        @JavascriptInterface fun nativeOpen(): Boolean = link.nativeOpen()
        @JavascriptInterface fun openWifi() {
            main.post {
                val i = if (Build.VERSION.SDK_INT >= 29) Intent(Settings.Panel.ACTION_WIFI) else Intent(Settings.ACTION_WIFI_SETTINGS)
                runCatching { startActivity(i) }.onFailure { runCatching { startActivity(Intent(Settings.ACTION_WIFI_SETTINGS)) } }
            }
        }
        @JavascriptInterface fun copy(text: String) {
            main.post {
                val cb = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
                cb.setPrimaryClip(ClipData.newPlainText("Wing Console log", text))
            }
        }
        @JavascriptInterface fun reload() { main.post { web.reload() } }
        @JavascriptInterface fun build(): Long = versionCode()
        @JavascriptInterface fun checkUpdate() = checkApkUpdate()
        /** Downloads the latest APK and opens the system installer. Returns "ok", or "perm" when Android first needs permission. */
        @JavascriptInterface fun downloadUpdate(): String {
            if (!packageManager.canRequestPackageInstalls()) {
                main.post { runCatching { startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))) } }
                return "perm"
            }
            main.post { startUpdateDownload() }
            return "ok"
        }
        /** 0–99 while downloading, 100 when done, -1 if it failed or nothing is running. */
        @JavascriptInterface fun updateProgress(): Int {
            val id = updateId
            if (id < 0) return -1
            val dm = getSystemService(DownloadManager::class.java)
            dm.query(DownloadManager.Query().setFilterById(id))?.use { c ->
                if (!c.moveToFirst()) return -1
                val status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                if (status == DownloadManager.STATUS_FAILED) return -1
                if (status == DownloadManager.STATUS_SUCCESSFUL) return 100
                val done = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                val total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                return if (total > 0) ((done * 99) / total).toInt() else 0
            }
            return -1
        }
    }

    companion object {
        const val HOST = "appassets.androidplatform.net"
        const val UPDATE_URL = "https://netchamo.github.io/wing-console/app/index.html"
        const val RELEASE_API = "https://api.github.com/repos/netchamo/wing-console/releases/tags/latest"
        const val APK_URL = "https://github.com/netchamo/wing-console/releases/download/latest/wing-console.apk"
        const val APK_MIME = "application/vnd.android.package-archive"
        const val CDN_HTM = "https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js"
    }
}
