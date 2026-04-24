package com.spatialmarkdown.engine.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.spatialmarkdown.engine.models.RenderCommand
import kotlin.math.roundToInt

@Composable
fun SpatialMarkdownCanvas(
    commands: List<RenderCommand>,
    modifier: Modifier = Modifier,
    imageResolver: (String) -> ImageBitmap? = { null }
) {
    val textMeasurer = rememberTextMeasurer()
    val densityObj = LocalDensity.current
    val density = densityObj.density
    val fontScale = densityObj.fontScale

    val px = { cssPx: Float -> cssPx * density }
    val toSp = { cssPx: Float -> (cssPx / fontScale).sp }

    var maxHeightCss = 0f
    for (command in commands) {
        val bottom = when (command) {
            is RenderCommand.FillRect -> command.y + command.height
            is RenderCommand.StrokeRect -> command.y + command.height
            is RenderCommand.DrawImage -> command.y + command.height
            is RenderCommand.ClipRect -> command.y + command.height
            // The TS Engine passes exact measured strings (often one command per line), 
            // but sometimes groups \n separated lines with a uniform line height.
            is RenderCommand.FillText -> command.y + (command.lineHeight * command.text.split('\n').size)
            is RenderCommand.DrawLine -> maxOf(command.y1, command.y2) + command.lineWidth
            is RenderCommand.RestoreClip -> 0f
        }
        if (bottom > maxHeightCss) maxHeightCss = bottom
    }

    val contentHeightDp = (maxHeightCss + 80f).dp

    Canvas(modifier = modifier.height(contentHeightDp)) {
        var clipStackDepth = 0

        for (command in commands) {
            when (command) {
                is RenderCommand.FillRect -> {
                    drawRoundRect(
                        color = parseCssColor(command.color),
                        topLeft = Offset(px(command.x), px(command.y)),
                        size = Size(px(command.width), px(command.height)),
                        cornerRadius = CornerRadius(px(command.borderRadius), px(command.borderRadius))
                    )
                }

                is RenderCommand.StrokeRect -> {
                    drawRoundRect(
                        color = parseCssColor(command.color),
                        topLeft = Offset(px(command.x), px(command.y)),
                        size = Size(px(command.width), px(command.height)),
                        cornerRadius = CornerRadius(px(command.borderRadius), px(command.borderRadius)),
                        style = Stroke(width = px(command.lineWidth))
                    )
                }

                is RenderCommand.FillText -> {
                    val parsedFont = parseCssFont(command.font)
                    val textStyle = TextStyle(
                        color = parseCssColor(command.color),
                        fontSize = toSp(parsedFont.size),
                        fontWeight = parsedFont.weight,
                        fontStyle = if (parsedFont.isItalic) FontStyle.Italic else FontStyle.Normal,
                        fontFamily = FontFamily.Default,
                        lineHeight = toSp(command.lineHeight),
                        textAlign = mapTextAlign(command.align ?: "left")
                    )

                    // The TS Engine handles all wrapping and layout constraints!
                    // The Android Canvas simply paints the string precisely at the coordinates.
                    // We turn off softWrap because the TS engine has already split lines where necessary.
                    drawText(
                        textMeasurer = textMeasurer,
                        text = command.text,
                        style = textStyle,
                        topLeft = Offset(px(command.x), px(command.y)),
                        softWrap = false
                    )
                }

                is RenderCommand.DrawLine -> {
                    drawLine(
                        color = parseCssColor(command.color),
                        start = Offset(px(command.x1), px(command.y1)),
                        end = Offset(px(command.x2), px(command.y2)),
                        strokeWidth = px(command.lineWidth)
                    )
                }

                is RenderCommand.DrawImage -> {
                    val bitmap = imageResolver(command.src)
                    if (bitmap != null) {
                        drawImage(
                            image = bitmap,
                            dstOffset = IntOffset(px(command.x).roundToInt(), px(command.y).roundToInt()),
                            dstSize = IntSize(px(command.width).roundToInt(), px(command.height).roundToInt())
                        )
                    }
                }

                is RenderCommand.ClipRect -> {
                    val path = Path().apply {
                        addRoundRect(
                            RoundRect(
                                left = px(command.x), top = px(command.y),
                                right = px(command.x + command.width), bottom = px(command.y + command.height),
                                cornerRadius = CornerRadius(px(command.borderRadius), px(command.borderRadius))
                            )
                        )
                    }
                    drawContext.canvas.save()
                    drawContext.canvas.clipPath(path)
                    clipStackDepth++
                }

                is RenderCommand.RestoreClip -> {
                    if (clipStackDepth > 0) {
                        drawContext.canvas.restore()
                        clipStackDepth--
                    }
                }
            }
        }

        while (clipStackDepth > 0) {
            drawContext.canvas.restore()
            clipStackDepth--
        }
    }
}

private fun parseCssColor(colorStr: String): Color {
    return try {
        if (colorStr.startsWith("rgba", ignoreCase = true)) {
            val values = colorStr.substringAfter("(").substringBefore(")").split(",")
            if (values.size == 4) {
                Color(
                    red = values[0].trim().toFloat() / 255f,
                    green = values[1].trim().toFloat() / 255f,
                    blue = values[2].trim().toFloat() / 255f,
                    alpha = values[3].trim().toFloat()
                )
            } else Color.Black
        } else {
            Color(android.graphics.Color.parseColor(colorStr))
        }
    } catch (e: Exception) {
        Color.Black
    }
}

private fun mapTextAlign(align: String): TextAlign {
    return when (align.lowercase()) {
        "center" -> TextAlign.Center
        "right" -> TextAlign.Right
        else -> TextAlign.Left
    }
}

private data class ParsedFont(val size: Float, val weight: FontWeight, val isItalic: Boolean)

private fun parseCssFont(fontStr: String): ParsedFont {
    var size = 14f
    var weight = FontWeight.Normal
    var isItalic = false

    val tokens = fontStr.split(" ", ",")
    for (token in tokens) {
        val t = token.trim().lowercase()
        if (t.endsWith("px")) {
            size = t.replace("px", "").toFloatOrNull() ?: 14f
        } else if (t == "bold" || t == "700") {
            weight = FontWeight.Bold
        } else if (t == "semibold" || t == "600") {
            weight = FontWeight.SemiBold
        } else if (t == "medium" || t == "500") {
            weight = FontWeight.Medium
        } else if (t == "light" || t == "300") {
            weight = FontWeight.Light
        } else if (t == "italic") {
            isItalic = true
        }
    }
    return ParsedFont(size, weight, isItalic)
}
