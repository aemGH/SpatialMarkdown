package com.spatialmarkdown.engine.core

import android.graphics.Paint
import android.graphics.Typeface
import android.util.Log

/**
 * JNI-facing text measurement bridge backed by [android.graphics.Paint].
 *
 * Registered as a JavaScript global `PaintBridge` inside the QuickJS runtime.
 * The TypeScript engine calls `PaintBridge.measureText(text, fontDescriptor)`
 * for every text measurement, which routes here. Using Android's native [Paint]
 * ensures that metrics match the actual fonts the Compose [Canvas] will render,
 * eliminating cross-host measurement drift.
 *
 * Thread-safety: this class is stateless (fresh [Paint] per call) and safe
 * to call from any QuickJS thread.
 */
class PaintMeasurementBridge {

    /**
     * Measure the width of [text] rendered in the given [fontDescriptor].
     *
     * The [fontDescriptor] is a CSS font shorthand string, e.g.:
     *   "800 42px Inter"
     *   "italic 14px sans-serif"
     *
     * We parse weight, style, size, and family heuristically. Unknown families
     * fall back to the system sans-serif.
     */
    fun measureText(text: String, fontDescriptor: String): Double {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = parseTypeface(fontDescriptor)
            textSize = parseTextSize(fontDescriptor)
        }
        return paint.measureText(text).toDouble()
    }

    // ─── CSS Font Shorthand Parsing ────────────────────────────────────

    private fun parseTextSize(descriptor: String): Float {
        // Extract the first "##px" token.
        val regex = """(\d+(?:\.\d+)?)\s*px""".toRegex()
        val match = regex.find(descriptor)
        return match?.groupValues?.get(1)?.toFloatOrNull() ?: 16f
    }

    private fun parseTypeface(descriptor: String): Typeface {
        val weight = when {
            descriptor.contains("100") -> 100
            descriptor.contains("200") -> 200
            descriptor.contains("300") -> 300
            descriptor.contains("400") || descriptor.contains("normal") -> 400
            descriptor.contains("500") -> 500
            descriptor.contains("600") -> 600
            descriptor.contains("700") || descriptor.contains("bold") -> 700
            descriptor.contains("800") -> 800
            descriptor.contains("900") -> 900
            else -> 400
        }

        val style = when {
            descriptor.contains("italic") || descriptor.contains("oblique") ->
                Typeface.ITALIC
            else -> Typeface.NORMAL
        }

        // Family token: the last word that isn't a size/weight/style keyword.
        val family = descriptor
            .split(" ")
            .filter { token ->
                token.isNotBlank()
                        && !token.endsWith("px")
                        && token.toIntOrNull() == null
                        && token !in STYLE_KEYWORDS
            }
            .lastOrNull()
            ?: "sans-serif"

        val typefaceStyle = when {
            style == Typeface.ITALIC && weight >= 700 -> Typeface.BOLD_ITALIC
            style == Typeface.ITALIC -> Typeface.ITALIC
            weight >= 700 -> Typeface.BOLD
            else -> Typeface.NORMAL
        }

        return try {
            Typeface.create(family, typefaceStyle)
        } catch (_: Exception) {
            Typeface.DEFAULT
        }
    }

    companion object {
        private val STYLE_KEYWORDS = setOf(
            "normal", "italic", "oblique", "bold", "lighter", "bolder",
            "small-caps", "initial", "inherit", "unset"
        )
        private const val TAG = "PaintMeasurementBridge"
    }
}
