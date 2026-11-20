// reducer.test.ts — applyEvent / hydrate 纯函数测试（无 React、无网络、无 DOM）
import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  hydrateState,
  reduceEvent,
  type StudioState,
} from '../src/store/reducer';
import type {
  ConsensusItem,
  Discussion,
  Message,
  PanelMember,
  SSEEvent,
} from '../src/types';

const member = (id: string, role: 'host' | 'expert' = 'expert'): PanelMember => ({
  id,
  discussionId: 'd1',
  name: id,
  role,
  title: 'title',
  position: 'position',
  stance: 'stance',
  color: '#111111',
  createdAt: '2026-01-01T00:00:00Z',
});

const message = (
  id: string,
  panelMemberId: string,
  content: string,
  createdAt = '2026-01-01T00:00:01Z',
): Message => ({
  id,
  discussionId: 'd1',
  panelMemberId,
  roundId: 'r1',
  content,
  type: 'speech',
  createdAt,
});

const consensusItem = (id: string, sourceMessageIds: string[] = []): ConsensusItem => ({
  id,
  discussionId: 'd1',
  type: 'consensus',
  content: `content-${id}`,
  sourceMessageIds,
  createdAt: '2026-01-01T00:00:02Z',
  updatedAt: '2026-01-01T00:00:02Z',
});

const discussion = (overrides: Partial<Discussion> = {}): Discussion => ({
  id: 'd1',
  topic: '测试话题',
  status: 'ongoing',
  expertCount: 2,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const event = (type: SSEEvent['type'], data: unknown): SSEEvent => ({ type, data });

function hydrated(): StudioState {
  return hydrateState(createInitialState('d1'), {
    discussion: discussion(),
    members: [member('host', 'host'), member('e1'), member('e2')],
    messages: [message('m0', 'host', '开场', '2026-01-01T00:00:00Z')],
    consensus: [],
  });
}

describe('hydrateState', () => {
  it('初始化所有成员为 idle，载入 transcript 与 phase', () => {
    const state = hydrated();

    expect(state.phase).toBe('ongoing');
    expect(state.runtimeStatus).toEqual({ host: 'idle', e1: 'idle', e2: 'idle' });
    expect(state.transcript.map((m) => m.id)).toEqual(['m0']);
  });

  it('重连 resync 时保留已有运行时状态', () => {
    let state = hydrated();
    state = reduceEvent(state, event('status_update', { panelMemberId: 'e1', status: 'speaking' }));

    const resynced = hydrateState(state, {
      discussion: discussion(),
      members: [member('host', 'host'), member('e1'), member('e2')],
      messages: [],
      consensus: [],
    });

    expect(resynced.runtimeStatus.e1).toBe('speaking');
    // 已有 transcript 不会被空消息列表清掉
    expect(resynced.transcript.map((m) => m.id)).toEqual(['m0']);
  });
});

describe('speech_chunk 累积', () => {
  it('按 panelMemberId 分别累积，互不干扰', () => {
    let state = hydrated();
    state = reduceEvent(state, event('speech_start', { panelMemberId: 'e1' }));
    state = reduceEvent(state, event('speech_chunk', { panelMemberId: 'e1', content: '你' }));
    state = reduceEvent(state, event('speech_chunk', { panelMemberId: 'e2', content: '我' }));
    state = reduceEvent(state, event('speech_chunk', { panelMemberId: 'e1', content: '好' }));

    expect(state.streamingText).toEqual({ e1: '你好', e2: '我' });
    expect(state.activeSpeakerId).toBe('e1');
  });

  it('speech_start 只重置自己的缓冲', () => {
    let state = hydrated();
    state = reduceEvent(state, event('speech_start', { panelMemberId: 'e1' }));
    state = reduceEvent(state, event('speech_chunk', { panelMemberId: 'e1', content: '你好' }));

    state = reduceEvent(state, event('speech_start', { panelMemberId: 'e2' }));

    expect(state.streamingText.e1).toBe('你好');
    expect(state.streamingText.e2).toBe('');
  });
});

describe('speech_end', () => {
  it('追加消息、清空缓冲、状态回到 idle', () => {
    let state = hydrated();
    state = reduceEvent(state, event('speech_start', { panelMemberId: 'e1' }));
    state = reduceEvent(state, event('speech_chunk', { panelMemberId: 'e1', content: '你好' }));
    state = reduceEvent(
      state,
      event('speech_end', { panelMemberId: 'e1', message: message('m1', 'e1', '你好') }),
    );

    expect(state.transcript.map((m) => m.id)).toEqual(['m0', 'm1']);
    expect(state.streamingText.e1).toBeUndefined();
    expect(state.runtimeStatus.e1).toBe('idle');
    expect(state.activeSpeakerId).toBeNull();
  });

  it('按 message.id 去重（重连全量回放不会重复）', () => {
    let state = hydrated();
    const end = event('speech_end', {
      panelMemberId: 'e1',
      message: message('m1', 'e1', '你好'),
    });

    state = reduceEvent(state, end);
    state = reduceEvent(state, end);
    state = reduceEvent(state, end);

    expect(state.transcript.filter((m) => m.id === 'm1')).toHaveLength(1);
  });
});

describe('回放幂等', () => {
  it('同一段 history（不含 chunk）应用两次，transcript/consensus 不重复', () => {
    const history: SSEEvent[] = [
      event('discussion_started', { discussion: discussion() }),
      event('status_update', { panelMemberId: 'e1', status: 'speaking' }),
      event('speech_start', { panelMemberId: 'e1' }),
      event('speech_end', { panelMemberId: 'e1', message: message('m1', 'e1', '发言') }),
      event('consensus_update', { items: [consensusItem('c1', ['m1'])] }),
      event('discussion_finished', {
        discussion: discussion({ status: 'finished', summary: '最终总结' }),
      }),
    ];

    let state = hydrated();
    for (const e of history) state = reduceEvent(state, e);
    const firstTranscript = state.transcript.map((m) => m.id);

    for (const e of history) state = reduceEvent(state, e);

    expect(state.transcript.map((m) => m.id)).toEqual(firstTranscript);
    expect(state.consensus).toHaveLength(1);
    expect(state.streamingText).toEqual({});
    expect(state.phase).toBe('finished');
  });
});

describe('consensus_update', () => {
  it('按 id 合并去重，保留 sourceMessageIds', () => {
    let state = hydrated();
    const update = event('consensus_update', { items: [consensusItem('c1', ['m1', 'm2'])] });

    state = reduceEvent(state, update);
    state = reduceEvent(state, update);

    expect(state.consensus).toHaveLength(1);
    expect(state.consensus[0].sourceMessageIds).toEqual(['m1', 'm2']);
  });
});

describe('流程事件', () => {
  it('discussion_started → ongoing', () => {
    let state = createInitialState('d1');
    state = reduceEvent(
      state,
      event('discussion_started', { discussion: discussion({ status: 'ongoing' }) }),
    );

    expect(state.phase).toBe('ongoing');
    expect(state.discussion?.status).toBe('ongoing');
  });

  it('discussion_finished → finished，并采用 payload 的 summary', () => {
    let state = hydrated();
    state = reduceEvent(
      state,
      event('discussion_finished', {
        discussion: discussion({ status: 'finished', summary: '收尾总结' }),
      }),
    );

    expect(state.phase).toBe('finished');
    expect(state.discussion?.status).toBe('finished');
    expect(state.summary).toBe('收尾总结');
  });

  it('discussion_summary 先到、finished payload 无 summary 时保留已有 summary', () => {
    let state = hydrated();
    state = reduceEvent(state, event('discussion_summary', { summary: '总结' }));
    state = reduceEvent(
      state,
      event('discussion_finished', { discussion: discussion({ status: 'finished' }) }),
    );

    expect(state.summary).toBe('总结');
  });

  it('status_update：speaking 设置 activeSpeaker，非法状态忽略', () => {
    let state = hydrated();
    state = reduceEvent(state, event('status_update', { panelMemberId: 'e2', status: 'speaking' }));
    expect(state.activeSpeakerId).toBe('e2');
    expect(state.runtimeStatus.e2).toBe('speaking');

    const unchanged = reduceEvent(
      state,
      event('status_update', { panelMemberId: 'e2', status: 'dancing' }),
    );
    expect(unchanged).toBe(state);
  });

  it('error 事件写入错误信息；未知事件返回原引用', () => {
    let state = hydrated();
    state = reduceEvent(state, event('error', { message: '出错了' }));
    expect(state.error).toBe('出错了');

    const unknown = reduceEvent(state, event('panel_generated', { panel: [] }));
    expect(unknown).toBe(state);
  });
});

describe('纯函数约束', () => {
  it('不修改入参（深冻结后仍可安全调用）', () => {
    const state = deepFreeze(hydrated());
    const snapshot = JSON.stringify(state);

    const next = reduceEvent(state, event('speech_start', { panelMemberId: 'e1' }));
    const after = reduceEvent(next, event('speech_chunk', { panelMemberId: 'e1', content: 'hi' }));

    expect(after.streamingText.e1).toBe('hi');
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
