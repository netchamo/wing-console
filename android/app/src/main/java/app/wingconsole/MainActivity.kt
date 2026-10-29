package app.wingconsole

import android.app.Activity
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
                return assets.shouldInterceptRequest(url)
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                jsReady = false
                // A downloaded interface that never starts is broken: drop it and use the built-in one.
                main.postDelayed({
                    if (!jsReady && servedDownloaded) { downloadedIndex()?.delete(); servedDownloaded = false; web.reload() }
                }, 12000)
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
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) goImmersive()
    }

    override fun onDestroy() {
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

    // ------------------------------------------------------------ bridge

    inner class Bridge {
        @JavascriptInterface fun ready() { jsReady = true }
        @JavascriptInterface fun version(): String = runCatching { packageManager.getPackageInfo(packageName, 0).versionName ?: "" }.getOrDefault("")
        @JavascriptInterface fun wifi(): Boolean = link.wifiAvailable()
        @JavascriptInterface fun discover(hint: String?) = link.discover(hint)
        @JavascriptInterface fun connect(ip: String) = link.connect(ip)
        @JavascriptInterface fun disconnect() = link.disconnect()
        /** Read-only: ask the mixer for the current value of each address (newline separated). */
        @JavascriptInterface fun query(addresses: String) = link.query(addresses)
        /** Live control: only after the user confirmed it in the app. */
        @JavascriptInterface fun setLive(on: Boolean) = link.setLive(on)
        @JavascriptInterface fun set(address: String, type: String, value: String) = link.set(address, type, value)
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
    }

    companion object {
        const val HOST = "appassets.androidplatform.net"
        const val UPDATE_URL = "https://netchamo.github.io/wing-console/app/index.html"
        const val CDN_HTM = "https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js"
    }
}
