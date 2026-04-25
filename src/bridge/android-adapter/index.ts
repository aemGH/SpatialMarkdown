import { createPipeline } from '../../pipeline';
import type { SpatialPipeline } from '../../pipeline';
import type { RenderCommand } from '../../types/render';
import { darkTheme } from '../../types/theme';

declare global {
  interface Window {
    // Injected by Android WebView's addJavascriptInterface
    AndroidSpatialBridge?: {
      onRenderCommands(jsonString: string): void;
    };
    // The API we expose to the Android host
    SpatialEngine: {
      init(width: number, height: number, themeMode?: 'light' | 'dark'): void;
      feed(text: string): void;
      flush(): void;
      resize(width: number, height: number): void;
      destroy(): void;
    };
  }
}

(() => {
  // Store the active pipeline instance
  let pipeline: SpatialPipeline | null = null;
  let unsubscribeRender: (() => void) | null = null;

  window.SpatialEngine = {
    init(width: number, height: number, themeMode: 'light' | 'dark' = 'light') {
      // Clean up previous instance if init is called multiple times
      if (pipeline) {
        this.destroy();
      }

      const config = themeMode === 'dark' ? { theme: darkTheme } : undefined;
      pipeline = createPipeline(config);

      // Initialize dimensions
      pipeline.resize(width, height);

      // Subscribe to render events to push JSON strings back to Kotlin
      unsubscribeRender = pipeline.onRender((commands: ReadonlyArray<RenderCommand>) => {
        if (window.AndroidSpatialBridge) {
          window.AndroidSpatialBridge.onRenderCommands(JSON.stringify(commands));
        } else {
          console.warn('AndroidSpatialBridge interface is not attached to window.');
        }
      });
    },

    feed(text: string) {
      if (pipeline !== null) {
        pipeline.feed(text);
      } else {
        console.warn('SpatialEngine: Pipeline not initialized. Call init() first.');
      }
    },

    resize(width: number, height: number) {
      if (pipeline !== null) {
        pipeline.resize(width, height);
      }
    },

    flush() {
      if (pipeline !== null) {
        pipeline.flush();
      }
    },

    destroy() {
      if (unsubscribeRender !== null) {
        unsubscribeRender();
        unsubscribeRender = null;
      }
      if (pipeline !== null) {
        pipeline.destroy();
      }
      pipeline = null;
    }
  };
})();
