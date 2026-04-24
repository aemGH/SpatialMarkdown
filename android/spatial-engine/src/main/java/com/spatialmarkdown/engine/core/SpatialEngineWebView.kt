package com.spatialmarkdown.engine.core

import android.annotation.SuppressLint
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.spatialmarkdown.engine.models.RenderCommand
import com.spatialmarkdown.engine.ui.SpatialMarkdownCanvas
import kotlinx.serialization.json.Json

/**
 * Controller allowing external interactions with the headless Spatial JS Engine.
 */
class SpatialEngineController(private val webViewProvider: () -> WebView?) {
    fun feed(textChunk: String) {
        val webView = webViewProvider() ?: return
        // Safe escaping for JS evaluation
        val escaped = textChunk
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            
        webView.evaluateJavascript("if(window.SpatialEngine) window.SpatialEngine.feed('$escaped');", null)
    }

    fun resize(width: Float, height: Float) {
        webViewProvider()?.evaluateJavascript(
            "if(window.SpatialEngine) window.SpatialEngine.resize($width, $height);", 
            null
        )
    }
}

/**
 * The JSON parser configured for Spatial Markdown constraints.
 */
private val SpatialJsonFormat = Json {
    ignoreUnknownKeys = true
    classDiscriminator = "kind" // Must match JSON polymorphic field
}

/**
 * The Headless Integration Layer.
 * Provides a Jetpack Compose wrapper that manages the headless WebView and draws the Canvas.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun SpatialEngineView(
    modifier: Modifier = Modifier,
    engineUrl: String = "file:///android_asset/spatial_engine.html",
    isDarkTheme: Boolean = isSystemInDarkTheme(),
    imageResolver: (String) -> androidx.compose.ui.graphics.ImageBitmap? = { null },
    onControllerReady: (SpatialEngineController) -> Unit
) {
    // State holding the latest geometry layout output from Layer A (The Brain)
    val renderCommands: MutableState<List<RenderCommand>> = remember { mutableStateOf(emptyList()) }
    
    // Hold reference to WebView to provide safely to controller
    val webViewRef = remember { arrayOf<WebView?>(null) }
    
    val scrollState = rememberScrollState()
    
    val configuration = LocalConfiguration.current
    val screenWidthDp = configuration.screenWidthDp.toFloat()
    val screenHeightDp = configuration.screenHeightDp.toFloat()
    
    val themeModeString = if (isDarkTheme) "dark" else "light"

    Box(modifier = modifier) {
        // Headless JS Engine Environment
        AndroidView(
            // Use 1.dp and 1f alpha. 
            // 0.dp or 0f alpha WebViews often have requestAnimationFrame suspended by Android!
            modifier = Modifier.size(1.dp).alpha(1f), 
            factory = { context ->
                WebView(context).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    
                    // Pipe JS Console logs to Android Logcat so we can see TS Engine errors!
                    webChromeClient = object : WebChromeClient() {
                        override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                            Log.d("SpatialEngineJS", "${consoleMessage?.message()} -- From line ${consoleMessage?.lineNumber()} of ${consoleMessage?.sourceId()}")
                            return super.onConsoleMessage(consoleMessage)
                        }
                    }

                    // ONLY notify the app that the controller is ready ONCE the HTML/JS has fully loaded.
                    webViewClient = object : WebViewClient() {
                        private var isReady = false
                        
                        override fun onPageFinished(view: WebView?, url: String?) {
                            super.onPageFinished(view, url)
                            if (!isReady) {
                                isReady = true
                                // Initialize engine before returning controller
                                evaluateJavascript("if(window.SpatialEngine) window.SpatialEngine.init($screenWidthDp, $screenHeightDp, '$themeModeString');", null)
                                onControllerReady(SpatialEngineController { webViewRef[0] })
                            }
                        }
                    }
                    
                    // The Integration Bridge linking Layer D to TS Layer A
                    addJavascriptInterface(object : Any() {
                        @JavascriptInterface
                        fun onRenderCommands(jsonString: String) {
                            try {
                                val commands = SpatialJsonFormat.decodeFromString<List<RenderCommand>>(jsonString)
                                // UI State must be updated on Main Thread
                                Handler(Looper.getMainLooper()).post {
                                    renderCommands.value = commands
                                }
                            } catch (e: Exception) {
                                Log.e("SpatialEngineBridge", "Failed to parse commands: ${e.message}")
                            }
                        }
                    }, "AndroidSpatialBridge")
                    
                    webViewRef[0] = this
                    loadUrl(engineUrl)
                }
            },
            onRelease = {
                webViewRef[0] = null
                it.destroy()
            }
        )
        
        // Auto-resize listener hidden inside the SDK
        // Automatically propagates orientation/resizing events to the TS engine
        LaunchedEffect(screenWidthDp, screenHeightDp) {
            val controller = SpatialEngineController { webViewRef[0] }
            controller.resize(screenWidthDp, screenHeightDp)
        }

        // Native Render Layer - The UI Canvas mapped safely beneath Compose bounds
        Box(modifier = Modifier.fillMaxSize().verticalScroll(scrollState)) {
            SpatialMarkdownCanvas(
                commands = renderCommands.value,
                modifier = Modifier.fillMaxWidth(),
                imageResolver = imageResolver
            )
        }
    }
}
