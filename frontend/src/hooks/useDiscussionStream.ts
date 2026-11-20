// useDiscussionStream.ts — EventSource 生命周期：建连、状态上报、重连补偿、关闭。
import { useEffect } from 'react';
import { openDiscussionStream, type DiscussionStream } from '../services/sse';
import { useStudioStore } from '../store/studioStore';

const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * @param discussionId 讨论 ID
 * @param enabled 仅当讨论已 hydrate 且处于 waiting / ongoing 时建连
 */
export function useDiscussionStream(discussionId: string | undefined, enabled: boolean): void {
  useEffect(() => {
    if (!discussionId || !enabled) return;

    const store = useStudioStore.getState;
    let stream: DiscussionStream | null = null;
    let disposed = false;
    let openedOnce = false;
    let attempts = 0;

    store().setConnection('connecting');

    stream = openDiscussionStream(discussionId, {
      onEvent(event) {
        store().applyEvent(event);

        // 讨论结束：服务端保持连接，客户端主动关闭
        if (event.type === 'discussion_finished') {
          stream?.close();
          store().setConnection('closed');
        }
      },

      onOpen() {
        if (disposed) return;
        attempts = 0;
        store().setConnection('open');

        // 重连成功：history 不含 chunk，用 REST 兜底补齐
        if (openedOnce) {
          void store().load(discussionId);
        }
        openedOnce = true;
      },

      onError(_error, willReconnect) {
        if (disposed) return;

        if (!willReconnect) {
          store().setConnection('closed');
          return;
        }

        attempts += 1;
        store().setConnection('reconnecting');

        if (attempts > MAX_RECONNECT_ATTEMPTS) {
          stream?.close();
          store().setConnection('closed');
          store().setError('连接中断，请刷新页面重试');
        }
      },
    });

    return () => {
      disposed = true;
      stream?.close();
      store().setConnection('closed');
    };
  }, [discussionId, enabled]);
}
