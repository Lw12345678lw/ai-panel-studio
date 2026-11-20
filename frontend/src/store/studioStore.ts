// studioStore.ts — 演播厅 zustand store。状态变换全部委托给纯 reducer。
import { create } from 'zustand';
import { discussionApi } from '../services/api';
import type { SSEEvent } from '../types';
import {
  createInitialState,
  hydrateState,
  reduceEvent,
  type ConnectionState,
  type StudioState,
} from './reducer';

interface StudioActions {
  /** 拉取存量数据；id 变化时重置状态 */
  load(id: string): Promise<void>;
  /** 手动开始讨论（返回后编排在后台继续，进度走 SSE） */
  start(): Promise<void>;
  applyEvent(event: SSEEvent): void;
  setConnection(connection: ConnectionState): void;
  setError(error: string | null): void;
}

export type StudioStore = StudioState & StudioActions;

const errorMessage = (e: unknown, fallback: string) =>
  e instanceof Error ? e.message : fallback;

export const useStudioStore = create<StudioStore>()((set, get) => ({
  ...createInitialState(null),

  async load(id) {
    if (get().discussionId !== id) {
      set(createInitialState(id));
    }

    try {
      const [discussion, members, messages, consensus] = await Promise.all([
        discussionApi.get(id),
        discussionApi.getMembers(id),
        discussionApi.getMessages(id),
        discussionApi.getConsensus(id),
      ]);
      set((state) => hydrateState(state, { discussion, members, messages, consensus }));
    } catch (e) {
      set({ phase: 'error', error: errorMessage(e, '加载讨论失败') });
    }
  },

  async start() {
    const id = get().discussionId;
    if (!id) return;

    try {
      const discussion = await discussionApi.start(id);
      set({ discussion, phase: 'ongoing', error: null });
    } catch (e) {
      set({ error: errorMessage(e, '开始讨论失败') });
    }
  },

  applyEvent(event) {
    set((state) => reduceEvent(state, event));
  },

  setConnection(connection) {
    set({ connection });
  },

  setError(error) {
    set({ error });
  },
}));
