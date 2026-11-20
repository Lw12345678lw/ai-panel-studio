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
  /** 拉取存量数据；id 变化时重置状态。8 秒未完成则进入 error 态 */
  load(id: string): Promise<void>;
  /** 手动开始讨论（返回后编排在后台继续，进度走 SSE） */
  start(): Promise<void>;
  /** 就地生成嘉宾阵容（同步接口，约 10~25 秒） */
  generatePanel(): Promise<void>;
  applyEvent(event: SSEEvent): void;
  setConnection(connection: ConnectionState): void;
  setError(error: string | null): void;
}

export type StudioStore = StudioState & StudioActions;

const errorMessage = (e: unknown, fallback: string) =>
  e instanceof Error ? e.message : fallback;

const LOAD_TIMEOUT_MS = 8000;

// 请求永不 resolve 时避免页面无限停留在 loading
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export const useStudioStore = create<StudioStore>()((set, get) => ({
  ...createInitialState(null),

  async load(id) {
    if (get().discussionId !== id) {
      set(createInitialState(id));
    }

    try {
      const [discussion, members, messages, consensus] = await withTimeout(
        Promise.all([
          discussionApi.get(id),
          discussionApi.getMembers(id),
          discussionApi.getMessages(id),
          discussionApi.getConsensus(id),
        ]),
        LOAD_TIMEOUT_MS,
        '加载超时，请重试',
      );

      // 页面已切到别的讨论时，丢弃迟到的响应
      if (get().discussionId !== id) return;

      set((state) => hydrateState(state, { discussion, members, messages, consensus }));
    } catch (e) {
      if (get().discussionId !== id) return;
      set({ phase: 'error', error: errorMessage(e, '加载讨论失败') });
    }
  },

  async generatePanel() {
    const id = get().discussionId;
    if (!id) return;

    try {
      const members = await discussionApi.generatePanel(id);
      const wasGenerating = get().discussion?.status === 'generating';

      set((state) => ({
        members,
        runtimeStatus: Object.fromEntries(
          members.map((member) => [member.id, state.runtimeStatus[member.id] ?? 'idle']),
        ),
        // 后端生成完成后会把 generating 置回 waiting，前端同步本地状态
        discussion:
          wasGenerating && state.discussion
            ? { ...state.discussion, status: 'waiting' }
            : state.discussion,
        phase: wasGenerating ? 'waiting' : state.phase,
        error: null,
      }));
    } catch (e) {
      set({ error: errorMessage(e, '生成嘉宾阵容失败') });
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
