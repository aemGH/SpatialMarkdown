/**
 * SSE (Server-Sent Events) adapter for the bridge layer.
 *
 * Connects to an SSE endpoint that emits UpstreamMessages as
 * JSON-encoded `data:` fields. Converts StreamChunkMessages to
 * StreamTokens and exposes them as a ReadableStream.
 *
 * This is a unidirectional transport — the SSE spec does not
 * support client-to-server messages. Use the WebSocket adapter
 * when bidirectional communication (backpressure signals) is needed.
 *
 * @module @spatial/bridge/streaming/sse-adapter
 */

import type { StreamToken, UpstreamMessage } from '../../types/stream';
import { timestamp } from '../../types/primitives';
import { deserializeUpstream } from './stream-protocol';

// ─── Public Interface ────────────────────────────────────────────────

export interface SSEAdapter {
  /**
   * Open an EventSource connection to the given URL and return a
   * ReadableStream of StreamTokens. Each upstream `chunk` message
   * is converted to a StreamToken; `end` messages close the stream.
   *
   * Calling `connect()` while already connected will disconnect
   * the previous connection first.
   */
  readonly connect: (url: string) => ReadableStream<StreamToken>;

  /** Close the underlying EventSource connection. */
  readonly disconnect: () => void;

  /** True when the EventSource is open or connecting. */
  readonly isConnected: () => boolean;
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createSSEAdapter(): SSEAdapter {
  let eventSource: EventSource | null = null;
  let connected = false;
  let accumulatedOffset = 0;

  function disconnect(): void {
    if (eventSource !== null) {
      eventSource.close();
      eventSource = null;
    }
    connected = false;
  }

  function isConnected(): boolean {
    return connected;
  }

  function connect(url: string): ReadableStream<StreamToken> {
    // Tear down any existing connection
    if (connected) {
      disconnect();
    }

    accumulatedOffset = 0;

    const stream = new ReadableStream<StreamToken>({
      start(controller): void {
        eventSource = new EventSource(url);
        connected = true;

        eventSource.onmessage = (event: MessageEvent<string>): void => {
          const msg = deserializeUpstream(event.data);
          if (msg === null) {
            return; // Silently skip malformed messages
          }

          handleUpstreamMessage(msg, controller);
        };

        eventSource.onerror = (): void => {
          // EventSource will auto-reconnect on transient errors.
          // If the connection is permanently closed, clean up.
          if (eventSource !== null && eventSource.readyState === EventSource.CLOSED) {
            connected = false;
            controller.close();
          }
        };
      },

      cancel(): void {
        disconnect();
      },
    });

    return stream;
  }

  function handleUpstreamMessage(
    msg: UpstreamMessage,
    controller: ReadableStreamDefaultController<StreamToken>,
  ): void {
    switch (msg.type) {
      case 'chunk': {
        const token: StreamToken = {
          kind: 'stream-token',
          text: msg.text,
          offset: accumulatedOffset,
          timestamp: timestamp(msg.ts),
          isFinal: false,
        };
        accumulatedOffset += msg.text.length;
        controller.enqueue(token);
        break;
      }

      case 'end': {
        // Emit a final empty token to signal stream completion
        const finalToken: StreamToken = {
          kind: 'stream-token',
          text: '',
          offset: accumulatedOffset,
          timestamp: timestamp(Date.now()),
          isFinal: true,
        };
        controller.enqueue(finalToken);
        controller.close();
        disconnect();
        break;
      }

      case 'error': {
        controller.error(new Error(`Stream error [${msg.code}]: ${msg.message}`));
        disconnect();
        break;
      }

      case 'config':
      case 'ping':
        // Config and ping messages are not relevant in SSE mode;
        // they require a bidirectional transport for responses.
        break;
    }
  }

  return { connect, disconnect, isConnected };
}
