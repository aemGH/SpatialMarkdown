package com.spatialmarkdown.engine.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import com.spatialmarkdown.engine.core.SpatialEngineView

/**
 * SpatialMarkdown — Zero-config Composable for rendering Spatial Markdown.
 *
 * The simplest way to use the engine on Android. Just pass your markup
 * and it handles everything: engine init, feeding, flushing, lifecycle.
 *
 * Survives rotation — the engine treats it as a viewport resize.
 *
 * @param content The Spatial Markdown string to render.
 * @param modifier Compose modifier for layout.
 * @param isDarkTheme Whether to use dark theme. Default: true.
 * @param imageResolver Optional resolver for <Image> src URLs.
 */
@Composable
fun SpatialMarkdown(
    content: String,
    modifier: Modifier = Modifier,
    isDarkTheme: Boolean = true,
    imageResolver: (String) -> ImageBitmap? = { null }
) {
    SpatialEngineView(
        modifier = modifier,
        isDarkTheme = isDarkTheme,
        imageResolver = imageResolver,
        onControllerReady = { controller ->
            // Feed content once on init. On rotation the engine already
            // has the content — onControllerReady re-fires but the engine
            // just needs a resize (handled automatically by onSizeChanged).
            controller.feed(content)
            controller.flush()
        }
    )
}

/**
 * SpatialMarkdownStream — Composable for streaming Spatial Markdown.
 *
 * Provides a [SpatialStreamController] via callback that lets you feed
 * chunks incrementally — perfect for LLM streaming responses.
 *
 * @param modifier Compose modifier for layout.
 * @param isDarkTheme Whether to use dark theme. Default: true.
 * @param imageResolver Optional resolver for <Image> src URLs.
 * @param onReady Called with a [SpatialStreamController] once the engine is initialized.
 */
@Composable
fun SpatialMarkdownStream(
    modifier: Modifier = Modifier,
    isDarkTheme: Boolean = true,
    imageResolver: (String) -> ImageBitmap? = { null },
    onReady: (SpatialStreamController) -> Unit
) {
    SpatialEngineView(
        modifier = modifier,
        isDarkTheme = isDarkTheme,
        imageResolver = imageResolver,
        onControllerReady = { controller ->
            onReady(SpatialStreamController(controller))
        }
    )
}

/**
 * Simplified controller for streaming content into the Spatial Markdown engine.
 */
class SpatialStreamController internal constructor(
    private val controller: com.spatialmarkdown.engine.core.SpatialEngineController
) {
    fun feed(chunk: String) = controller.feed(chunk)
    fun feedComplete(markup: String) { controller.feed(markup); controller.flush() }
    fun flush() = controller.flush()
    fun resize(width: Float, height: Float) = controller.resize(width, height)
}
