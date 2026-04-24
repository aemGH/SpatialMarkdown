package com.spatialmarkdown.engine.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Sealed class representing all possible Spatial Engine render commands.
 * The TS engine serializes these as JSON, using the "kind" field as the discriminator.
 */
@Serializable
sealed class RenderCommand {
    abstract val nodeId: Int

    @Serializable
    @SerialName("fill-rect")
    data class FillRect(
        override val nodeId: Int,
        val x: Float, val y: Float, val width: Float, val height: Float,
        val color: String, val borderRadius: Float
    ) : RenderCommand()

    @Serializable
    @SerialName("stroke-rect")
    data class StrokeRect(
        override val nodeId: Int,
        val x: Float, val y: Float, val width: Float, val height: Float,
        val color: String, val lineWidth: Float, val borderRadius: Float
    ) : RenderCommand()

    @Serializable
    @SerialName("fill-text")
    data class FillText(
        override val nodeId: Int,
        val text: String,
        val x: Float, val y: Float,
        val font: String,
        val color: String,
        val maxWidth: Float,
        val lineHeight: Float,
        val align: String? = "left"
    ) : RenderCommand()

    @Serializable
    @SerialName("draw-image")
    data class DrawImage(
        override val nodeId: Int,
        val src: String,
        val x: Float, val y: Float, val width: Float, val height: Float
    ) : RenderCommand()

    @Serializable
    @SerialName("clip-rect")
    data class ClipRect(
        override val nodeId: Int,
        val x: Float, val y: Float, val width: Float, val height: Float,
        val borderRadius: Float
    ) : RenderCommand()

    @Serializable
    @SerialName("restore-clip")
    data class RestoreClip(
        override val nodeId: Int
    ) : RenderCommand()

    @Serializable
    @SerialName("draw-line")
    data class DrawLine(
        override val nodeId: Int,
        val x1: Float, val y1: Float, val x2: Float, val y2: Float,
        val color: String, val lineWidth: Float
    ) : RenderCommand()
}
