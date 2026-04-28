package com.spatialmarkdown.engine.core

import android.app.Activity
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import com.spatialmarkdown.engine.models.RenderCommand
import com.spatialmarkdown.engine.ui.SpatialMarkdownCanvas
import kotlinx.serialization.json.Json

private val SpatialJsonFormat = Json {
    ignoreUnknownKeys = true
    classDiscriminator = "kind"
}

/**
 * Global engine holder that survives configuration changes.
 *
 * Rotation is just a resize — the engine handles it via its existing
 * resize() path. We keep the engine alive across config changes and
 * only destroy it when the Activity actually finishes.
 */
private object RetainedEngine {
    var holder: EngineHolder? = null
}

/**
 * The Headless QuickJS Integration Layer.
 *
 * Rotation is treated as a resize, not a restart. The QuickJS engine
 * persists across configuration changes and only gets destroyed when
 * the Activity finishes. The existing `onSizeChanged` → `resize()` path
 * handles the new viewport dimensions automatically.
 *
 * @param modifier Compose modifier for layout.
 * @param engineUrl Ignored in QuickJS mode (bundle is compiled-in). Kept for API parity.
 * @param isDarkTheme Whether to use dark theme.
 * @param imageResolver Optional image resolver.
 * @param onControllerReady Callback fired with a controller once the engine is ready.
 * @param onRenderCommandsJSON Optional callback with raw JSON for debugging/testing.
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
    val activity = context as? Activity

    // Get or create the engine — persists across rotation via static holder
    val engineHolder = remember {
        val existing = RetainedEngine.holder
        if (existing != null && !existing.destroyed) {
            // Survived rotation — swap render callback to fresh Compose state
            existing.engine.setRenderCallback { jsonString ->
                onRenderCommandsJSON?.invoke(jsonString)
                try {
                    val commands = SpatialJsonFormat.decodeFromString<List<RenderCommand>>(jsonString)
                    renderCommands.value = commands
                } catch (e: Exception) {
                    android.util.Log.e("SpatialEngine", "Failed to parse commands: ${e.message}")
                }
            }
            existing
        } else {
            // Fresh engine
            val engine = SpatialEngine(context) { jsonString ->
                onRenderCommandsJSON?.invoke(jsonString)
                try {
                    val commands = SpatialJsonFormat.decodeFromString<List<RenderCommand>>(jsonString)
                    renderCommands.value = commands
                } catch (e: Exception) {
                    android.util.Log.e("SpatialEngine", "Failed to parse commands: ${e.message}")
                }
            }
            val holder = EngineHolder(engine)
            RetainedEngine.holder = holder
            holder
        }
    }

    // Track composable size in dp
    val sizeDp = remember { mutableStateOf(androidx.compose.ui.unit.IntSize.Zero) }

    // Init engine only once. On rotation the engine survived — just resize (handled by onSizeChanged).
    LaunchedEffect(engineHolder) {
        if (!engineHolder.initialised) {
            val themeString = if (isDarkTheme) "dark" else "light"
            val (w, h) = sizeDp.value.let { Pair(it.width.toFloat(), it.height.toFloat()) }
            val initW = if (w > 0) w else 411f
            val initH = if (h > 0) h else 914f
            try {
                withContext(Dispatchers.IO) {
                    engineHolder.engine.init(initW, initH, themeString)
                }
            } catch (e: Exception) {
                android.util.Log.e("SpatialEngineView", "Engine init failed: ${e.message}")
                return@LaunchedEffect
            }
            engineHolder.initialised = true
            val controller = SpatialEngineController { engineHolder.engine }
            engineHolder.controller = controller
            onControllerReady(controller)
        }
        // On rotation: engine survived, content is intact, onSizeChanged will
        // trigger resize() which re-renders at the new viewport. Nothing else needed.
    }

    // Rotation = size change. The engine handles this via resize().
    LaunchedEffect(sizeDp.value) {
        val (w, h) = sizeDp.value.let { Pair(it.width.toFloat(), it.height.toFloat()) }
        if (engineHolder.initialised && w > 0 && h > 0) {
            engineHolder.engine.resize(w, h)
        }
    }

    // Only destroy when Activity is actually finishing — NOT on rotation.
    DisposableEffect(Unit) {
        onDispose {
            if (activity == null || activity.isFinishing) {
                engineHolder.engine.destroy()
                engineHolder.destroyed = true
                engineHolder.initialised = false
                engineHolder.controller = null
                RetainedEngine.holder = null
            }
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
        Box(modifier = Modifier.fillMaxSize().verticalScroll(scrollState)) {
            SpatialMarkdownCanvas(
                commands = renderCommands.value,
                modifier = Modifier.fillMaxWidth(),
                imageResolver = imageResolver
            )
        }
    }
}

private class EngineHolder(
    val engine: SpatialEngine,
    var initialised: Boolean = false,
    var destroyed: Boolean = false,
    var controller: SpatialEngineController? = null
)

/**
 * Controller allowing external interactions with the QuickJS Spatial Engine.
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
