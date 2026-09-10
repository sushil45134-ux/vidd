package com.vidd.app

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ProgressBar
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * VID APP — poori website is WebView ke andar chalti hai.
 *
 * Features:
 *  - Fullscreen video (YouTube + direct mp4)
 *  - Pull-to-refresh, Back navigation, Splash, Offline/Retry page
 *  - File upload (thumbnail/photo chunna), bahar ke links external apps me
 *
 * Website ka link badalna ho to sirf ye file dekho:
 *   app/src/main/res/values/strings.xml  ->  site_url
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var progressBar: ProgressBar
    private lateinit var splashView: View
    private lateinit var errorView: View
    private lateinit var fullscreenContainer: FrameLayout

    // Fullscreen video ke liye
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    // File upload ke liye
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private val filePickerLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val uris: Array<Uri>? = if (result.resultCode == RESULT_OK) {
                val data = result.data
                when {
                    data?.clipData != null -> {
                        val clip = data.clipData!!
                        Array(clip.itemCount) { i -> clip.getItemAt(i).uri }
                    }
                    data?.data != null -> arrayOf(data.data!!)
                    else -> null
                }
            } else null
            filePathCallback?.onReceiveValue(uris)
            filePathCallback = null
        }

    private val siteUrl: String by lazy { getString(R.string.site_url).trim().trimEnd('/') }
    private val siteHost: String? by lazy {
        try { Uri.parse(siteUrl).host?.lowercase() } catch (_: Exception) { null }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        // Splash theme se normal theme par wapas (manifest me splash lagaya hai
        // taaki app khulte hi turant logo dikhe)
        setTheme(R.style.Theme_Vidd)
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        swipeRefresh = findViewById(R.id.swipeRefresh)
        progressBar = findViewById(R.id.progressBar)
        splashView = findViewById(R.id.splashView)
        errorView = findViewById(R.id.errorView)
        fullscreenContainer = findViewById(R.id.fullscreenContainer)
        findViewById<Button>(R.id.retryButton).setOnClickListener {
            errorView.visibility = View.GONE
            splashView.visibility = View.VISIBLE
            webView.reload()
        }

        // ---------- WebView settings (streaming site ke liye tuned) ----------
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            loadsImagesAutomatically = true
            mediaPlaybackRequiresUserGesture = false   // video autoplay chale
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = false
            // App se aaya request hai — website chahe to pehchaan sake
            userAgentString = "$userAgentString ViddApp/1.0"
        }
        // YouTube embeds ke liye third-party cookies zaruri hain
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        webView.webViewClient = object : WebViewClient() {

            // Kaunsa link app ke andar khule, kaunsa bahar — yahaan decide hota hai
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                val scheme = request.url.scheme?.lowercase()
                // tel:, mailto:, whatsapp:, intent: waghera → bahar wali app me kholo
                if (scheme != null && scheme != "http" && scheme != "https") {
                    return openOutside(url)
                }
                val host = request.url.host?.lowercase() ?: return false
                // Apni website + video/CDN hosts → app ke andar hi kholo
                if (host == siteHost || host.endsWith(".${siteHost ?: "§"}") || isMediaHost(host)) {
                    return false
                }
                // Koi aur website → phone ke browser me kholo
                return openOutside(url)
            }

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                errorView.visibility = View.GONE
                progressBar.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                progressBar.visibility = View.GONE
                swipeRefresh.isRefreshing = false
                // Pehli baar page load hote hi splash hatao
                if (splashView.visibility == View.VISIBLE) {
                    splashView.animate().alpha(0f).setDuration(300).withEndAction {
                        splashView.visibility = View.GONE
                        splashView.alpha = 1f
                    }.start()
                }
            }

            override fun onReceivedError(
                view: WebView, request: WebResourceRequest, error: WebResourceError
            ) {
                super.onReceivedError(view, request, error)
                // Sirf main page fail ho tabhi error screen dikhao (chhoti image fail ho to nahi)
                if (request.isForMainFrame) {
                    progressBar.visibility = View.GONE
                    swipeRefresh.isRefreshing = false
                    splashView.visibility = View.GONE
                    errorView.visibility = View.VISIBLE
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progressBar.progress = newProgress
                progressBar.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
            }

            // ---- Fullscreen video (player ka fullscreen button) ----
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (customView != null) {
                    callback.onCustomViewHidden()
                    return
                }
                customView = view
                customViewCallback = callback
                fullscreenContainer.addView(
                    view,
                    ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                )
                fullscreenContainer.visibility = View.VISIBLE
                hideSystemBars(true)
            }

            override fun onHideCustomView() {
                customView?.let { fullscreenContainer.removeView(it) }
                customView = null
                fullscreenContainer.visibility = View.GONE
                customViewCallback?.onCustomViewHidden()
                customViewCallback = null
                hideSystemBars(false)
            }

            // ---- File upload (photo/thumbnail chunna) ----
            override fun onShowFileChooser(
                webView: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                return try {
                    filePickerLauncher.launch(params.createIntent())
                    true
                } catch (_: ActivityNotFoundException) {
                    filePathCallback = null
                    false
                }
            }

            // Camera/Mic permission maange to de do (upload flows ke liye)
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { request.grant(request.resources) }
            }
        }

        // Koi file download ho to browser/download manager me kholo
        webView.setDownloadListener { url, _, _, _, _ -> openOutside(url) }

        // Pull-to-refresh
        swipeRefresh.setColorSchemeResources(R.color.red)
        swipeRefresh.setOnRefreshListener { webView.reload() }

        // Back button: fullscreen → band karo, warna website me peeche jao
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    customView != null -> webView.webChromeClient?.onHideCustomView()
                    webView.canGoBack() -> webView.goBack()
                    else -> { isEnabled = false; onBackPressedDispatcher.onBackPressed() }
                }
            }
        })

        // Pehla page: notification/deep-link se aaya ho to wahi, warna home
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            val startUrl = intent?.data?.toString() ?: siteUrl
            webView.loadUrl(startUrl)
        }
    }

    /** Video/CDN hosts jo app ke andar hi khulne chahiye. */
    private fun isMediaHost(host: String): Boolean {
        val mediaHosts = listOf(
            "youtube.com", "youtu.be", "ytimg.com", "googlevideo.com",
            "vimeo.com", "vimeocdn.com", "dailymotion.com", "dmcdn.net",
            "bitchute.com", "odysee.com", "odycdn.com", "streamable.com",
            "twitch.tv", "facebook.com", "fbcdn.net", "supabase.co"
        )
        return mediaHosts.any { host == it || host.endsWith(".$it") }
    }

    /** Link ko phone ke browser / sahi app me kholo. */
    private fun openOutside(url: String): Boolean {
        return try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }

    private fun hideSystemBars(hide: Boolean) {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            if (hide) {
                hide(WindowInsetsCompat.Type.systemBars())
                systemBarsBehavior =
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            } else {
                show(WindowInsetsCompat.Type.systemBars())
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::webView.isInitialized) webView.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        if (::webView.isInitialized) webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) webView.onResume()
    }

    override fun onDestroy() {
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }
}
