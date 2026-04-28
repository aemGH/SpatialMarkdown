package com.spatialmarkdown.engine.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import com.spatialmarkdown.engine.core.SpatialEngineController
import com.spatialmarkdown.engine.core.SpatialEngineView

/**
 * SpatialMarkdown — Zero-config Composable for rendering Spatial Markdown.
 *
 * The simplest way to use the engine on Android. Just pass your markup
 * and it handles everything: engine init, feeding, flushing, lifecycle.
 *
 * Survives configuration changes (rotation) — the engine re-initializes
 * and re-feeds the content automatically.
 *
 * @param content The Spatial Markdown string to render.
 * @param modifier Compose modifier for layout.
 * @param isDarkTheme Whether to use dark theme. Default: true.
 * @param imageResolver Optional resolver for <Image> src URLs.
 *
 * @sample
 * ```kotlin
 * SpatialMarkdown(
 *     content = "<Slide><Heading level={1}>Hello Android!</Heading></Slide>",
 *     modifier = Modifier.fillMaxWidth()
 * )
 * ```
 */
@Composable
fun SpatialMarkdown(
    content: String,
    modifier: Modifier = Modifier,
    isDarkTheme: Boolean = true,
    imageResolver: (String) -> ImageBitmap? = { null }
) {
    // Hold a reference to the controller so we can re-feed on content changes.
    var controller by remember { mutableStateOf<SpatialEngineController?>(null) }

    SpatialEngineView(
        modifier = modifier,
        isDarkTheme = isDarkTheme,
        imageResolver = imageResolver,
        onControllerReady = { ctrl ->
            // Engine just (re-)initialized — feed content immediately.
            // This runs after init completes; feed() posts to the JS executor thread.
            try {
                ctrl.feed(content)
                ctrl.flush()
            } catch (e: Exception) {
                android.util.Log.w("SpatialMarkdown", "Feed after init failed (rotation?): ${e.message}")
            }
            controller = ctrl
        }
    )
}

/**
 * SpatialMarkdownStream — Composable for streaming Spatial Markdown.
 *
 * Provides a [SpatialStreamController] via callback that lets you feed
 * chunks incrementally — perfect for LLM streaming responses.
 *
 * Survives configuration changes (rotation) — but active streams will
 * need to be restarted by the caller since the engine reinitializes.
 *
 * @param modifier Compose modifier for layout.
 * @param isDarkTheme Whether to use dark theme. Default: true.
 * @param imageResolver Optional resolver for <Image> src URLs.
 * @param onReady Called with a [SpatialStreamController] once the engine is initialized.
 *                This may be called again after configuration changes (rotation).
 *
 * @sample
 * ```kotlin
 * SpatialMarkdownStream(
 *     modifier = Modifier.fillMaxWidth().weight(1f),
 *     onReady = { stream ->
 *         for (chunk in llmResponse) {
 *             stream.feed(chunk)
 *         }
 *         stream.flush()
 *     }
 * )
 * ```
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
 * Wraps [SpatialEngineController] with a cleaner API.
 */
class SpatialStreamController internal constructor(
    private val controller: SpatialEngineController
) {
    /** Feed a chunk of Spatial Markdown text. */
    fun feed(chunk: String) {
        controller.feed(chunk)
    }

    /** Feed a complete document and flush. */
    fun feedComplete(markup: String) {
        controller.feed(markup)
        controller.flush()
    }

    /** Flush any pending tokenizer state. Call after streaming is complete. */
    fun flush() {
        controller.flush()
    }

    /** Resize the viewport. */
    fun resize(width: Float, height: Float) {
        controller.resize(width, height)
    }
}
