package com.gamingate.gateway

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.gamingate.gateway.registry.RegistryValidator

/**
 * Project Gamingate - Phase 1 Android WebView DRM probe (throwaway-OK).
 *
 * Fullscreen system WebView running assets/probe.html: the same Widevine EME
 * config ladder as desktop plus navigator.getGamepads() enumeration. The D-03
 * tier decision (WebView accepted at provider-served SD vs Chrome Custom Tabs
 * fallback) is recorded from this measurement on a PHYSICAL ARM64 device -
 * emulator evidence is inadmissible (emulators lack real CDM provisioning).
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView

    // PERF-02: ensures the device cold-start marker is logged exactly once even
    // when the page fires onPageFinished more than once (redirects).
    private var coldStartReported = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // PERF-02: device cold-start measurement anchored at onCreate. The delta to
        // the first WebView page-finish is logged as `COLD_START_MS=<n>
        // surface=webview` and read on a physical ARM64 device via `adb logcat`
        // (docs/PERF-02-cold-start.md). Emulator evidence is inadmissible.
        val coldStartNs = SystemClock.elapsedRealtime()

        // REG-01 fail closed: validate the shared registry against the committed
        // schema BEFORE any provider surface can load. An invalid packet throws
        // and no WebView is ever created.
        validateBundledRegistry()

        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            // Probe scope: no local-file or content-provider access (T-01-06).
            allowFileAccess = false
            allowContentAccess = false
        }
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (!coldStartReported) {
                    coldStartReported = true
                    val elapsedMs = SystemClock.elapsedRealtime() - coldStartNs
                    Log.i(TAG, "COLD_START_MS=$elapsedMs surface=webview")
                }
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                // Grant only the WebRTC media resources the probe page asks for.
                request.grant(request.resources)
            }
        }

        setContentView(webView)
        goImmersive()

        // Recorded alongside the on-page JSON (VAL-02). Model + WebView version
        // only - never account or device identifiers.
        Log.i(TAG, "WebView package: ${WebView.getCurrentWebViewPackage()?.versionName}")

        webView.loadUrl("file:///android_asset/probe.html")
    }

    private fun validateBundledRegistry() {
        val registry = assets.open("registry/platforms.json").bufferedReader().use { it.readText() }
        val schema = assets.open("registry/platforms.schema.json").bufferedReader().use { it.readText() }
        try {
            RegistryValidator.validate(registry, schema)
        } catch (error: Exception) {
            // Fail closed: log the offending field and refuse to continue.
            Log.e(TAG, "platforms.json failed validation; refusing to load", error)
            throw error
        }
    }

    private fun goImmersive() {
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
    }

    @Deprecated("Deprecated in API 33; kept for minSdk 30 back navigation")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    companion object {
        private const val TAG = "GamingateProbe"
    }
}
