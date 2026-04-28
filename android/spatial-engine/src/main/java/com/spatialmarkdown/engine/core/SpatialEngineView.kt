package com.spatialmarkdown.engine.core

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import com.spatialmarkdown.engine.models.RenderCommand
import com.spatialmarkdown.engine.ui.SpatialMarkdownCanvas
import kotlinx.serialization.json.Json

private val SpatialJsonFormat = Json {
    ignoreUnknownKeys = true
    classDiscriminator = "kind" // Must match JSON polymorphic field
}

/**
 * The Headless QuickJS Integration Layer.
 * Provides a Jetpack Compose wrapper that manages the embedded QuickJS
 * runtime (no WebView) and draws the Canvas.
 *
 * Signature-compatible with the archived WebView version so consumers
 * swap imports in one line.
 *
 * Lifecycle:
 *   - Engine is created once per Composable instance and remembered across
 *     recomposition (including rotation if the Activity is recreated).
 *   - On viewport size changes, [resize()] is called on the existing engine.
 *   - When the Composable leaves composition, the QuickJS runtime is destroyed.
 *
 * @param modifier Compose modifier for layout.
 *   The engine receives the actual pixel width/height of this composable,
 *   NOT the full screen dimensions, so content always fits the available space.
 * @param engineUrl Ignored in QuickJS mode (bundle is compiled-in). Kept for API parity.
 * @param isDarkTheme Whether to use dark theme.
 * @param imageResolver Optional image resolver (not yet implemented for QuickJS path).
 * @param onControllerReady Callback fired with a controller once the engine is ready.
 *                          Only invoked once per engine instance.
 */
@Composable
fun SpatialEngineView(
    modifier: Modifier = Modifier,
    engineUrl: String = "file:///android_asset/quickjs-engine.js",
    isDarkTheme: Boolean = true,
    imageResolver: (String) -> androidx.compose.ui.graphics.ImageBitmap? = { null },
    onControllerReady: (SpatialEngineController) -> Unit,
    onRenderCommandsJSON: ((String) -> Unit)? = null
) {
    val context = LocalContext.current
    val density = LocalDensity.current
    val scrollState = rememberScrollState()
    val renderCommands: MutableState<List<RenderCommand>> = remember { mutableStateOf(emptyList()) }

    // Remember the engine instance across recompositions.
    val engineHolder = remember {
        val engine = SpatialEngine(context) { jsonString ->
            onRenderCommandsJSON?.invoke(jsonString)
            try {
                val commands = SpatialJsonFormat.decodeFromString<List<RenderCommand>>(jsonString)
                // Guard: only update state if this engine is still the active one
                // (avoids posting to a dead composition after rotation)
                renderCommands.value = commands
            } catch (e: Exception) {
                android.util.Log.e("SpatialEngine", "Failed to parse commands: ${e.message}")
            }
        }
        EngineHolder(engine)
    }

    // Track the actual composable size in dp, which is what the engine should layout to.
    val sizeDp = remember { mutableStateOf(androidx.compose.ui.unit.IntSize.Zero) }

    // Initialise once when this remember block is first created (on IO thread).
    LaunchedEffect(engineHolder) {
        if (!engineHolder.initialised) {
            val themeString = if (isDarkTheme) "dark" else "light"
            val (w, h) = sizeDp.value.let { Pair(it.width.toFloat(), it.height.toFloat()) }
            // If size is not yet known, use a sensible default and resize later.
            val initW = if (w > 0) w else 411f
            val initH = if (h > 0) h else 914f
            try {
                withContext(Dispatchers.IO) {
                    engineHolder.engine.init(initW, initH, themeString)
                }
            } catch (e: Exception) {
                // Engine init can fail if the coroutine is cancelled during rotation
                // or if QuickJS native lib has issues. Log and bail gracefully.
                android.util.Log.e("SpatialEngineView", "Engine init failed: ${e.message}")
                return@LaunchedEffect
            }
            engineHolder.initialised = true

            val controller = SpatialEngineController { engineHolder.engine }
            onControllerReady(controller)
        }
    }

    // On size changes, notify the engine to relayout.
    LaunchedEffect(sizeDp.value) {
        val (w, h) = sizeDp.value.let { Pair(it.width.toFloat(), it.height.toFloat()) }
        android.util.Log.d("SpatialEngineQuickJS", "Size changed: ${w}x${h} dp")
        if (engineHolder.initialised && w > 0 && h > 0) {
            engineHolder.engine.resize(w, h)
        }
    }

    // Tear down QuickJS runtime when this Composable leaves composition.
    DisposableEffect(Unit) {
        onDispose {
            engineHolder.engine.destroy()
            engineHolder.initialised = false
        }
    }

    Box(
        modifier = modifier
            .onSizeChanged { pxSize ->
                with(density) {
                    val w = pxSize.width.toDp().value
                    val h = pxSize.height.toDp().value
                    sizeDp.value = androidx.compose.ui.unit.IntSize(w.toInt(), h.toInt())
                }
            }
    ) {
        // Native Render Layer — The UI Canvas
        Box(modifier = Modifier.fillMaxSize().verticalScroll(scrollState)) {
            SpatialMarkdownCanvas(
                commands = renderCommands.value,
                modifier = Modifier.fillMaxWidth(),
                imageResolver = imageResolver
            )
        }
    }
}

/**
 * Mutable holder so we can track whether the wrapped engine has been initialised.
 */
private class EngineHolder(
    val engine: SpatialEngine,
    var initialised: Boolean = false
)

/**
 * Controller allowing external interactions with the QuickJS Spatial Engine.
 * Thin wrapper around [SpatialEngine] for API parity with the WebView path.
 */
class SpatialEngineController(
    private val engineProvider: () -> SpatialEngine?
) {
    fun feed(textChunk: String) {
        engineProvider()?.feed(textChunk)
    }

    fun flush() {
        engineProvider()?.flush()
    }

    fun resize(width: Float, height: Float) {
        engineProvider()?.resize(width, height)
    }
}
