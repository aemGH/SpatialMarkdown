/**
 * WebSocket adapter for the bridge layer — bidirectional transport.
 *
 * Connects to a WebSocket endpoint that sends UpstreamMessages and
 * accepts DownstreamMessages (backpressure signals, acks, pongs).
 *
 * Converts incoming StreamChunkMessages to StreamTokens and exposes
 * them as a ReadableStream, while allowing the caller to send
 * DownstreamMessages back through the same connection.
 *
 * @module @spatial/bridge/streaming/ws-adapter
 */

import type {
  StreamToken,
  UpstreamMessage,
  DownstreamMessage,
} from '../../types/stream';
import { timestamp } from '../../types/primitives';
import { deserializeUpstream, serializeDownstream } from './stream-protocol';

// ─── Public Interface ────────────────────────────────────────────────

export interface WSAdapter {
  /**
   * Open a WebSocket connection and return a ReadableStream of StreamTokens.
   * Upstream chunk messages are converted to tokens; end messages close the stream.
   *
   * Calling `connect()` while already connected will disconnect
   * the previous connection first.
   */
  readonly connect: (url: string) => ReadableStream<StreamToken>;

  /** Close the WebSocket connection with a normal closure code. */
  readonly disconnect: () => void;

  /**
   * Send a downstream message (ack, backpressure, pong) to the Python SDK.
   * Throws if the adapter is not connected.
   */
  readonly send: (msg: DownstreamMessage) => void;

  /** True when the WebSocket is in the OPEN state. */
  readonly isConnected: () => boolean;
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createWSAdapter(): WSAdapter {
  let ws: WebSocket | null = null;
  let connected = false;
  let accumulatedOffset = 0;

  function disconnect(): void {
    if (ws !== null) {
      // 1000 = normal closure
      ws.close(1000, 'client disconnect');
      ws = null;
    }
    connected = false;
  }

  function isConnected(): boolean {
    return connected;
  }

  function send(msg: DownstreamMessage): void {
    if (ws === null || !connected) {
      throw new Error('WSAdapter: cannot send — not connected');
    }
    ws.send(serializeDownstream(msg));
  }

  function connect(url: string): ReadableStream<StreamToken> {
    // Tear down any existing connection
    if (connected) {
      disconnect();
    }

    accumulatedOffset = 0;

    const stream = new ReadableStream<StreamToken>({
      start(controller): void {
        ws = new WebSocket(url);
        ws.binaryType = 'blob'; // Default; we only use text frames

        ws.onopen = (): void => {
          connected = true;
        };

        ws.onmessage = (event: MessageEvent<string>): void => {
          const msg = deserializeUpstream(
            typeof event.data === 'string' ? event.data : '',
          );
          if (msg === null) {
            return; // Skip malformed messages
          }

          handleUpstreamMessage(msg, controller);
        };

        ws.onerror = (): void => {
          // The error event doesn't carry useful information in the browser.
          // The close event that follows will handle cleanup.
        };

        ws.onclose = (event: CloseEvent): void => {
          connected = false;
          if (event.code !== 1000) {
            // Abnormal closure — propagate as a stream error
            controller.error(
              new Error(`WebSocket closed abnormally: code=${String(event.code)} reason=${event.reason}`),
            );
          } else {
            controller.close();
          }
          ws = null;
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
        // Config updates and pings are handled at a higher layer;
        // they don't produce StreamTokens. A production implementation
        // would emit these on a separate event channel.
        break;
    }
  }

  return { connect, disconnect, send, isConnected };
}
