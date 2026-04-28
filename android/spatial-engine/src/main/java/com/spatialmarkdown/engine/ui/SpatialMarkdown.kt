package com.spatialmarkdown.engine.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import com.spatialmarkdown.engine.core.SpatialEngineController
import com.spatialmarkdown.engine.core.SpatialEngineView
import kotlinx.coroutines.launch

/**
 * SpatialMarkdown — Zero-config Composable for rendering Spatial Markdown.
 *
 * The simplest way to use the engine on Android. Just pass your markup
 * and it handles everything: engine init, feeding, flushing, lifecycle.
 *
 * For streaming use cases, use [rememberSpatialController] instead.
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
    val scope = rememberCoroutineScope()
    var lastFedContent by remember { mutableStateOf("") }

    SpatialEngineView(
        modifier = modifier,
        isDarkTheme = isDarkTheme,
        imageResolver = imageResolver,
        onControllerReady = { controller ->
            scope.launch {
                controller.feed(content)
                controller.flush()
                lastFedContent = content
            }
        }
    )

    // Re-feed when content changes after initial mount
    LaunchedEffect(content) {
        // Initial content is handled by onControllerReady above
        if (content != lastFedContent && lastFedContent.isNotEmpty()) {
            // Content changed — need to re-feed
            // Note: This requires the controller to support clear + re-feed.
            // For now, only works for initial content.
            lastFedContent = content
        }
    }
}

/**
 * SpatialMarkdownStream — Composable for streaming Spatial Markdown.
 *
 * Provides a [SpatialStreamController] that lets you feed chunks
 * incrementally — perfect for LLM streaming responses.
 *
 * @param modifier Compose modifier for layout.
 * @param isDarkTheme Whether to use dark theme. Default: true.
 * @param imageResolver Optional resolver for <Image> src URLs.
 * @param onReady Called with a [SpatialStreamController] once the engine is initialized.
 *
 * @sample
 * ```kotlin
 * SpatialMarkdownStream(
 *     modifier = Modifier.fillMaxWidth().weight(1f),
 *     onReady = { stream ->
 *         // Feed chunks from your LLM stream
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
    onReady: suspend (SpatialStreamController) -> Unit
) {
    val scope = rememberCoroutineScope()

    SpatialEngineView(
        modifier = modifier,
        isDarkTheme = isDarkTheme,
        imageResolver = imageResolver,
        onControllerReady = { controller ->
            scope.launch {
                val streamController = SpatialStreamController(controller)
                onReady(streamController)
            }
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
