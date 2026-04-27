package com.spatialmarkdown.engine.core

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.whl.quickjs.wrapper.JSCallFunction
import com.whl.quickjs.wrapper.QuickJSContext
import com.whl.quickjs.android.QuickJSLoader
import java.io.IOException
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * QuickJS-backed Spatial Markdown engine host.
 *
 * Replaces the WebView-based [SpatialEngineController] with an embedded
 * QuickJS runtime that evaluates the same TypeScript IIFE bundle.
 *
 * All JS operations (create, evaluate, destroy) happen on a single dedicated
 * background thread to satisfy QuickJS's thread-affinity requirement:
 *   "Must be call same thread in QuickJSContext.create!"
 * The [onRenderCommands] callback is automatically marshalled back to the
 * main thread via a [Handler].
 *
 * Architecture:
 *   1. Loads `assets/quickjs-engine.js` (the IIFE bundle built by Vite).
 *   2. Registers `PaintBridge` as a JS global so the engine can measure
 *      text via [android.graphics.Paint].
 *   3. Exposes `feed()`, `flush()`, `resize()`, and `destroy()` to Kotlin consumers.
 *   4. Receives render commands via a JS→Kotlin callback and forwards
 *      them to [onRenderCommands] on the main looper.
 *   5. Injects a proper `setTimeout`/`clearTimeout` polyfill so the frame
 *      scheduler's `setTimeout(cb, 16)` actually defers ~16 ms instead of
 *      running immediately as a microtask.
 *
 * Cold-start target: ≤300 ms (vs. WebView's ~1500 ms).
 *
 * @param context Android Context for asset loading.
 * @param onRenderCommands Callback fired with JSON render-command arrays (main thread).
 */
class SpatialEngine(
    private val context: Context,
    private val onRenderCommands: (jsonString: String) -> Unit,
) {
    private var quickJSContext: QuickJSContext? = null
    private val paintBridge = PaintMeasurementBridge()

    /**
     * Single dedicated scheduled thread for ALL QuickJS operations.
     * QuickJS requires create + evaluate to happen on the same thread.
     */
    private val executor: ScheduledExecutorService =
        Executors.newSingleThreadScheduledExecutor { Thread(it, "SpatialEngine-JS") }

    /** Handler to post render results back to the main thread. */
    private val mainHandler = Handler(Looper.getMainLooper())

    /** Whether the engine has been initialised and is ready for input. */
    val isReady: Boolean
        get() = quickJSContext != null

    /**
     * Initialise the QuickJS runtime and load the engine bundle.
     * Blocks the calling thread until initialisation completes (call from a
     * background coroutine, e.g. `withContext(Dispatchers.IO)`).
     */
    fun init(width: Float, height: Float, themeMode: String = "light") {
        if (quickJSContext != null) {
            Log.w(TAG, "init() called twice — destroying previous runtime.")
            destroy()
        }

        // Submit init work to the dedicated JS thread and block until done.
        executor.submit(Callable {
            val start = System.currentTimeMillis()

            // 1. Load native QuickJS library (required once per process)
            QuickJSLoader.init()

            // 2. Create QuickJS runtime + context
            val ctx = QuickJSContext.create().also { quickJSContext = it }

            // 2a. Wire console.log/warn/error to Android Logcat
            QuickJSLoader.initConsoleLog(ctx)

            // 2b. Polyfills — minimal env, window, timers, Intl
            ctx.evaluate("var node_module = undefined;", "polyfill-node-module.js")
            ctx.evaluate("var window = globalThis;", "polyfill-window.js")

            // Timer polyfill: defer via microtask
            ctx.evaluate(
                """
                var __timerMap = new Map();
                var __nextTimerId = 1;
                globalThis.setTimeout = function(fn, delay) {
                    var id = __nextTimerId++;
                    var cancelled = false;
                    __timerMap.set(id, function() { cancelled = true; });
                    Promise.resolve().then(function() {
                        if (!cancelled) fn();
                        __timerMap.delete(id);
                    });
                    return id;
                };
                globalThis.clearTimeout = function(id) {
                    var cancel = __timerMap.get(id);
                    if (cancel) {
                        cancel();
                        __timerMap.delete(id);
                    }
                };
                """.trimIndent(),
                "polyfill-timers.js"
            )
            ctx.evaluate(
                """
                var Intl = {
                    Segmenter: function(locale, options) {
                        this.granularity = options && options.granularity ? options.granularity : 'grapheme';
                    }
                };
                Intl.Segmenter.prototype.segment = function(string) {
                    var granularity = this.granularity;
                    var segments;
                    if (granularity === 'word') {
                        segments = string.split(/(\s+)/).filter(function(s) { return s.length > 0; }).map(function(s) {
                            return { segment: s, isWordLike: !/^\s+$$/.test(s) };
                        });
                    } else {
                        segments = Array.from(string).map(function(s) {
                            return { segment: s, isWordLike: true };
                        });
                    }
                    return segments;
                };
                """.trimIndent(),
                "polyfill-intl.js"
            )

            // 3. Register PaintBridge for text measurement
            val paintBridgeObj = ctx.createNewJSObject()
            paintBridgeObj.setProperty(
                "measureText",
                JSCallFunction { args ->
                    val text = args[0]?.toString() ?: ""
                    val font = args[1]?.toString() ?: "16px sans-serif"
                    paintBridge.measureText(text, font)
                }
            )
            ctx.getGlobalObject().setProperty("PaintBridge", paintBridgeObj)
            paintBridgeObj.release()

            // 4. Register AndroidSpatialBridge for render-command callback
            val bridgeObj = ctx.createNewJSObject()
            bridgeObj.setProperty(
                "onRenderCommands",
                JSCallFunction { args ->
                    val json = args[0]?.toString() ?: ""
                    Log.d(TAG, "GOLDEN_JSON: $json")
                    mainHandler.post { onRenderCommands(json) }
                    null
                }
            )
            ctx.getGlobalObject().setProperty("AndroidSpatialBridge", bridgeObj)
            bridgeObj.release()

            // 5. Load the IIFE bundle from assets
            val bundle = loadAsset("quickjs-engine.js")
            ctx.evaluate(bundle, "quickjs-engine.js")

            // 7. Call the engine's init() with viewport + theme
            ctx.evaluate(
                """
                if (typeof SpatialEngine !== 'undefined') {
                    SpatialEngine.init(${width}, ${height}, '${themeMode}');
                }
                """.trimIndent()
            )

            val elapsed = System.currentTimeMillis() - start
            Log.i(TAG, "QuickJS engine initialised in ${elapsed}ms")
        }).get()
    }

    /** Feed a chunk of Spatial Markdown text into the engine (background thread). */
    fun feed(chunk: String) {
        if (chunk.isEmpty() || executor.isShutdown) return
        try {
            executor.execute {
                val ctx = quickJSContext ?: return@execute
                val escaped = chunk
                    .replace("\\", "\\\\")
                    .replace("'", "\\'")
                    .replace("\n", "\\n")
                    .replace("\r", "\\r")
                ctx.evaluate("if(window.SpatialEngine) window.SpatialEngine.feed('$escaped');")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to execute feed", e)
        }
    }

    /** Explicitly flush any pending tokenizer / scheduler state. */
    fun flush() {
        if (executor.isShutdown) return
        try {
            executor.execute {
                val ctx = quickJSContext ?: return@execute
                ctx.evaluate("if(window.SpatialEngine && window.SpatialEngine.flush) window.SpatialEngine.flush();")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to execute flush", e)
        }
    }

    /** Notify the engine of a viewport resize (background thread). */
    fun resize(width: Float, height: Float) {
        if (executor.isShutdown) return
        try {
            executor.execute {
                val ctx = quickJSContext ?: return@execute
                ctx.evaluate("if(window.SpatialEngine) window.SpatialEngine.resize($width, $height);")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to execute resize", e)
        }
    }

    /** Tear down the QuickJS runtime and background executor. */
    fun destroy() {
        if (executor.isShutdown) return
        try {
            executor.execute {
                quickJSContext?.destroy()
                quickJSContext = null
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to destroy context", e)
        }
        executor.shutdown()
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    private fun loadAsset(path: String): String {
        return try {
            context.assets.open(path).bufferedReader().use { it.readText() }
        } catch (e: IOException) {
            throw IllegalStateException("Missing engine asset: $path", e)
        }
    }

    companion object {
        private const val TAG = "SpatialEngine"
    }
}
