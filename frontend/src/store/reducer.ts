// reducer.ts — 演播厅纯状态变换：hydrate + applyEvent。
// 硬约束：不读 Date.now / Math.random，不发请求，不修改入参。
import type {
  ConsensusItem,
  Discussion,
  Message,
  PanelMember,
  PanelMemberStatus,
  SSEEvent,
} from '../types';

export type StudioPhase = 'idle' | 'loading' | 'waiting' | 'ongoing' | 'finished' | 'error';
export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface StudioState {
  discussionId: string | null;
  discussion: Discussion | null;
  members: PanelMember[];
  transcript: Message[];
  runtimeStatus: Record<string, PanelMemberStatus>;
  activeSpeakerId: string | null;
  streamingText: Record<string, string>;
  consensus: ConsensusItem[];
  summary: string | null;
  phase: StudioPhase;
  connection: ConnectionState;
  error: string | null;
}

export interface HydratePayload {
  discussion: Discussion;
  members: PanelMember[];
  messages: Message[];
  consensus: ConsensusItem[];
}

const STATUSES: PanelMemberStatus[] = ['idle', 'preparing', 'speaking'];

function isStatus(value: unknown): value is PanelMemberStatus {
  return typeof value === 'string' && (STATUSES as string[]).includes(value);
}

function phaseFromStatus(status: string): StudioPhase {
  switch (status) {
    case 'waiting':
      return 'waiting';
    case 'generating':
      return 'loading';
    case 'ongoing':
      return 'ongoing';
    case 'finished':
      return 'finished';
    default:
      return 'idle';
  }
}

function createdAtOf(value: { createdAt?: string | Date }): number {
  return value.createdAt ? new Date(value.createdAt).getTime() : 0;
}

function sortByCreatedAt<T extends { createdAt?: string | Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => createdAtOf(a) - createdAtOf(b));
}

function dataOf(event: SSEEvent): Record<string, unknown> {
  return (event.data ?? {}) as Record<string, unknown>;
}

export function createInitialState(discussionId: string | null): StudioState {
  return {
    discussionId,
    discussion: null,
    members: [],
    transcript: [],
    runtimeStatus: {},
    activeSpeakerId: null,
    streamingText: {},
    consensus: [],
    summary: null,
    phase: discussionId ? 'loading' : 'idle',
    connection: 'idle',
    error: null,
  };
}

export function hydrateState(state: StudioState, payload: HydratePayload): StudioState {
  // 重连 resync 时保留已有运行时状态（避免把正在发言的人打回 idle）
  const runtimeStatus: Record<string, PanelMemberStatus> = {};
  for (const member of payload.members) {
    runtimeStatus[member.id] = state.runtimeStatus[member.id] ?? 'idle';
  }

  const transcriptById = new Map<string, Message>();
  for (const message of [...state.transcript, ...payload.messages]) {
    if (message?.id) transcriptById.set(message.id, message);
  }

  const consensusById = new Map<string, ConsensusItem>();
  for (const item of [...state.consensus, ...payload.consensus]) {
    if (item?.id) consensusById.set(item.id, item);
  }

  return {
    ...state,
    discussionId: payload.discussion.id,
    discussion: payload.discussion,
    members: payload.members,
    transcript: sortByCreatedAt([...transcriptById.values()]),
    runtimeStatus,
    consensus: sortByCreatedAt([...consensusById.values()]),
    summary: payload.discussion.summary ?? state.summary,
    phase: phaseFromStatus(payload.discussion.status),
    error: null,
  };
}

export function reduceEvent(state: StudioState, event: SSEEvent): StudioState {
  const data = dataOf(event);

  switch (event.type) {
    case 'discussion_started': {
      const discussion = data.discussion as Discussion | undefined;
      return {
        ...state,
        discussion: discussion ?? state.discussion,
        phase: 'ongoing',
        error: null,
      };
    }

    case 'status_update': {
      const panelMemberId = data.panelMemberId;
      const status = data.status;
      if (typeof panelMemberId !== 'string' || !isStatus(status)) return state;
      return {
        ...state,
        runtimeStatus: { ...state.runtimeStatus, [panelMemberId]: status },
        // idle 不立刻清 activeSpeakerId，等 speech_end 再清，避免字幕先消失
        activeSpeakerId: status === 'speaking' ? panelMemberId : state.activeSpeakerId,
      };
    }

    case 'speech_start': {
      const panelMemberId = data.panelMemberId;
      if (typeof panelMemberId !== 'string') return state;
      return {
        ...state,
        activeSpeakerId: panelMemberId,
        streamingText: { ...state.streamingText, [panelMemberId]: '' },
      };
    }

    case 'speech_chunk': {
      const panelMemberId = data.panelMemberId;
      const content = data.content;
      if (typeof panelMemberId !== 'string' || typeof content !== 'string') return state;
      return {
        ...state,
        streamingText: {
          ...state.streamingText,
          [panelMemberId]: (state.streamingText[panelMemberId] ?? '') + content,
        },
      };
    }

    case 'speech_end': {
      const panelMemberId = data.panelMemberId;
      const message = data.message as Message | undefined;
      if (!message?.id) return state;

      const alreadyStored = state.transcript.some((m) => m.id === message.id);
      const transcript = alreadyStored ? state.transcript : [...state.transcript, message];

      const streamingText = { ...state.streamingText };
      if (typeof panelMemberId === 'string') delete streamingText[panelMemberId];

      const runtimeStatus =
        typeof panelMemberId === 'string'
          ? { ...state.runtimeStatus, [panelMemberId]: 'idle' as const }
          : state.runtimeStatus;

      return {
        ...state,
        transcript,
        streamingText,
        runtimeStatus,
        activeSpeakerId:
          state.activeSpeakerId === panelMemberId ? null : state.activeSpeakerId,
      };
    }

    case 'consensus_update': {
      const items = data.items;
      if (!Array.isArray(items)) return state;
      const byId = new Map(state.consensus.map((item) => [item.id, item]));
      for (const item of items as ConsensusItem[]) {
        if (item?.id) byId.set(item.id, item);
      }
      return { ...state, consensus: [...byId.values()] };
    }

    case 'discussion_summary': {
      const summary = data.summary;
      return typeof summary === 'string' ? { ...state, summary } : state;
    }

    case 'discussion_finished': {
      const discussion = data.discussion as Discussion | undefined;
      const summary =
        typeof discussion?.summary === 'string' && discussion.summary
          ? discussion.summary
          : state.summary;
      return {
        ...state,
        discussion: discussion ?? state.discussion,
        summary,
        phase: 'finished',
      };
    }

    case 'error': {
      const message = data.message;
      return { ...state, error: typeof message === 'string' ? message : '未知错误' };
    }

    // panel_generating / panel_generated 为预留事件，当前不影响演播厅状态
    default:
      return state;
  }
}
