// sse.ts — EventSource 封装：命名事件监听 + 连接状态回调。
// 重连交给浏览器原生 EventSource（服务端下发 retry: 3000）。
import type { SSEEvent, SSEEventType } from '../types';

const EVENT_TYPES: SSEEventType[] = [
  'panel_generating',
  'panel_generated',
  'discussion_started',
  'speech_start',
  'speech_chunk',
  'speech_end',
  'status_update',
  'consensus_update',
  'discussion_summary',
  'discussion_finished',
  'error',
];

export interface DiscussionStreamHandlers {
  onEvent(event: SSEEvent): void;
  onOpen?(): void;
  /** willReconnect=true 表示浏览器仍会按 retry 自动重连 */
  onError?(error: Event, willReconnect: boolean): void;
}

export interface DiscussionStream {
  close(): void;
  readonly readyState: number;
}

export function openDiscussionStream(
  discussionId: string,
  handlers: DiscussionStreamHandlers,
): DiscussionStream {
  const source = new EventSource(`/api/discussions/${discussionId}/stream`);

  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (event) => {
      const message = event as MessageEvent<string>;
      let data: unknown = null;
      if (message.data) {
        try {
          data = JSON.parse(message.data);
        } catch {
          // 单帧脏数据不影响后续事件
          return;
        }
      }
      handlers.onEvent({ type, data });
    });
  }

  source.onopen = () => {
    handlers.onOpen?.();
  };

  source.onerror = (event) => {
    // CONNECTING：浏览器正在自动重连；CLOSED：不会再重连
    handlers.onError?.(event, source.readyState === EventSource.CONNECTING);
  };

  return {
    close() {
      source.close();
    },
    get readyState() {
      return source.readyState;
    },
  };
}
