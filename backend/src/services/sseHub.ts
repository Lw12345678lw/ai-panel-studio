// sseHub.ts — 进程内 SSE 事件中枢：按 discussionId 隔离的广播 + 历史回放。
// 只负责事件与序号，不碰 HTTP Response（由路由层负责 SSE 帧格式与连接生命周期）。

export interface HubEvent {
  id: number;
  type: string;
  data: unknown;
}

export interface PublishableEvent {
  type: string;
  data: unknown;
}

export type HubListener = (event: HubEvent) => void;

export interface SseHubOptions {
  /** history 最多保留多少条（speech_chunk 不进入 history） */
  historyLimit?: number;
  /** discussion_finished 之后多久清理该讨论的 history 与订阅者 */
  finishedTtlMs?: number;
}

export interface SseHub {
  publish(discussionId: string, event: PublishableEvent): void;
  subscribe(discussionId: string, listener: HubListener): () => void;
  /** 返回 id > lastEventId 的历史事件（按 id 升序），用于 Last-Event-ID 增量回放 */
  replaySince(discussionId: string, lastEventId: number): HubEvent[];
  subscriberCount(discussionId: string): number;
  historySize(discussionId: string): number;
}

interface DiscussionState {
  seq: number;
  history: HubEvent[];
  listeners: Set<HubListener>;
  cleanupTimer?: NodeJS.Timeout;
}

const DEFAULT_HISTORY_LIMIT = 500;
const DEFAULT_FINISHED_TTL_MS = 15 * 60_000;

export function createSseHub(options: SseHubOptions = {}): SseHub {
  const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  const finishedTtlMs = options.finishedTtlMs ?? DEFAULT_FINISHED_TTL_MS;
  const states = new Map<string, DiscussionState>();

  const getState = (discussionId: string): DiscussionState => {
    let state = states.get(discussionId);
    if (!state) {
      state = { seq: 0, history: [], listeners: new Set() };
      states.set(discussionId, state);
    }
    return state;
  };

  return {
    publish(discussionId, event) {
      const state = getState(discussionId);
      const hubEvent: HubEvent = { id: ++state.seq, type: event.type, data: event.data };

      // chunk 不回放：speech_end 已带完整 message，重连时不需要逐块补课
      if (event.type !== 'speech_chunk') {
        state.history.push(hubEvent);
        if (state.history.length > historyLimit) {
          state.history.splice(0, state.history.length - historyLimit);
        }
      }

      for (const listener of [...state.listeners]) {
        try {
          listener(hubEvent);
        } catch {
          state.listeners.delete(listener);
        }
      }

      if (event.type === 'discussion_finished') {
        if (state.cleanupTimer) clearTimeout(state.cleanupTimer);
        state.cleanupTimer = setTimeout(() => {
          states.delete(discussionId);
        }, finishedTtlMs);
        state.cleanupTimer.unref?.();
      }
    },

    subscribe(discussionId, listener) {
      const state = getState(discussionId);
      state.listeners.add(listener);
      return () => {
        states.get(discussionId)?.listeners.delete(listener);
      };
    },

    replaySince(discussionId, lastEventId) {
      const state = states.get(discussionId);
      if (!state) return [];
      return state.history.filter((e) => e.id > lastEventId);
    },

    subscriberCount(discussionId) {
      return states.get(discussionId)?.listeners.size ?? 0;
    },

    historySize(discussionId) {
      return states.get(discussionId)?.history.length ?? 0;
    },
  };
}
