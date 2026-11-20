// orchestrator.test.ts — TDD：讨论编排器契约测试（先写测试，实现尚未存在，预期全红）
// 所有 LLM 调用通过 mock 完成，绝不真实调用 DeepSeek。
import { describe, it, expect, vi } from 'vitest';
import { runDiscussion } from '../src/services/orchestrator';

// ===== 契约定义（实现 orchestrator.ts 时对齐）=====
// runDiscussion(discussionId, { llm, db, emit })
//   llm.streamSpeech(messages, onChunk) -> Promise<string>                 主持人/专家发言（流式）
//   llm.selectSpeakers(messages, speechCounts) -> Promise<{speakers:string[]}>  选人
//   llm.extractConsensus(messages) -> Promise<{items:{type,content}[]}>        共识提炼
//   db.getDiscussion / getMembers / createRound / closeRound / createMessage
//   db.createConsensusItem / createConsensusSource / finishDiscussion
//   emit(event) -> { type, data }    // SSE 事件

interface Member {
  id: string;
  role: 'host' | 'expert';
  name?: string;
}

function makeMembers(expertCount: number): Member[] {
  return [
    { id: 'host', role: 'host' },
    ...Array.from({ length: expertCount }, (_, i) => ({ id: `e${i + 1}`, role: 'expert' as const })),
  ];
}

// 带名字的成员：用于「模型返回名字」的回归用例
function makeNamedMembers(expertCount: number): Member[] {
  return [
    { id: 'host', role: 'host', name: '主持人' },
    ...Array.from({ length: expertCount }, (_, i) => ({
      id: `e${i + 1}`,
      role: 'expert' as const,
      name: `专家${i + 1}`,
    })),
  ];
}

// 假 DB：记录所有调用与写入结果，供断言
function makeDb(members: Member[]) {
  const rounds: any[] = [];
  const messages: any[] = [];
  const consensusItems: any[] = [];
  const consensusSources: any[] = [];
  let finished: string | null = null;

  return {
    rounds,
    messages,
    consensusItems,
    consensusSources,
    getFinished: () => finished,
    getDiscussion: vi.fn().mockResolvedValue({
      id: 'd1',
      topic: '测试话题',
      expertCount: members.filter((m) => m.role === 'expert').length,
    }),
    getMembers: vi.fn().mockResolvedValue(members),
    createRound: vi.fn().mockImplementation(async (d: any) => {
      const r = { id: `round-${d.seq}`, ...d, status: 'open' };
      rounds.push(r);
      return r;
    }),
    closeRound: vi.fn().mockImplementation(async (id: string) => {
      const r = rounds.find((x) => x.id === id);
      if (r) r.status = 'closed';
    }),
    createMessage: vi.fn().mockImplementation(async (d: any) => {
      const m = { id: `msg-${messages.length + 1}`, ...d };
      messages.push(m);
      return m;
    }),
    createConsensusItem: vi.fn().mockImplementation(async (d: any) => {
      const c = { id: `cons-${consensusItems.length + 1}`, ...d };
      consensusItems.push(c);
      return c;
    }),
    createConsensusSource: vi.fn().mockImplementation(async (d: any) => {
      consensusSources.push(d);
    }),
    finishDiscussion: vi.fn().mockImplementation(async (_id: string, summary: string) => {
      finished = summary;
    }),
  };
}

// 假 LLM
function makeLlm() {
  return {
    streamSpeech: vi.fn(),
    selectSpeakers: vi.fn(),
    extractConsensus: vi.fn(),
  };
}

// 事件收集器
function makeEvents() {
  const events: any[] = [];
  return { events, emit: (e: any) => events.push(e) };
}

// 默认 LLM 行为：发言流式返回「发言」，选人返回 e1/e2，共识为空
function setupLlmDefaults(llm: any) {
  llm.streamSpeech.mockImplementation(async (_m: any, onChunk: (c: string) => void) => {
    onChunk('发言');
    return '发言';
  });
  llm.selectSpeakers.mockResolvedValue({ speakers: ['e1', 'e2'] });
  llm.extractConsensus.mockResolvedValue({ items: [] });
}

describe('runDiscussion', () => {
  it('轮数驱动：4 专家 → 4 轮，跑完自动收尾', async () => {
    const members = makeMembers(4);
    const db = makeDb(members);
    const llm = makeLlm();
    setupLlmDefaults(llm);
    const { events, emit } = makeEvents();

    await runDiscussion('d1', { llm, db, emit });

    expect(db.createRound).toHaveBeenCalledTimes(4);
    expect(db.rounds.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
    expect(db.rounds.every((r) => r.status === 'closed')).toBe(true);
    expect(db.finishDiscussion).toHaveBeenCalledTimes(1);
    expect(db.getFinished()).toBeTruthy();
    expect(events.at(-1)?.type).toBe('discussion_finished');
  });

  it('选人护栏：同轮去重、跨轮可重复、发言次数权重生效', async () => {
    const members = makeMembers(4);
    const db = makeDb(members);
    const llm = makeLlm();
    setupLlmDefaults(llm);
    // 第1轮选人返回 [e1,e1,e2]（同轮重复 e1）；第2轮 [e1,e3]（跨轮 e1 可重复）
    llm.selectSpeakers
      .mockResolvedValueOnce({ speakers: ['e1', 'e1', 'e2'] })
      .mockResolvedValueOnce({ speakers: ['e1', 'e3'] })
      .mockResolvedValue({ speakers: ['e1', 'e2'] });
    const { events, emit } = makeEvents();

    await runDiscussion('d1', { llm, db, emit });

    // 同轮去重：第1轮 e1 只发言一次
    const round1 = db.messages.filter((m) => m.roundId === 'round-1');
    expect(round1.filter((m) => m.panelMemberId === 'e1')).toHaveLength(1);

    // 跨轮可重复：e1 在第1轮和第2轮都有发言
    const e1RoundIds = db.messages.filter((m) => m.panelMemberId === 'e1').map((m) => m.roundId);
    expect(e1RoundIds).toContain('round-1');
    expect(e1RoundIds).toContain('round-2');

    // 发言次数权重：第2轮选人调用时，e1 已发言 1 次，e3 为 0
    const secondCallCounts = llm.selectSpeakers.mock.calls[1][1];
    expect(secondCallCounts['e1']).toBe(1);
    expect(secondCallCounts['e3']).toBe(0);
  });

  it('护栏：某专家前 2 轮未被选中，第 3 轮被强制安排发言', async () => {
    const members = makeMembers(4);
    const db = makeDb(members);
    const llm = makeLlm();
    setupLlmDefaults(llm);
    // 每轮选人都只返回 e1、e2，不选 e3；e3 前 2 轮 0 发言，第 3 轮应被强制
    llm.selectSpeakers.mockResolvedValue({ speakers: ['e1', 'e2'] });
    const { events, emit } = makeEvents();

    await runDiscussion('d1', { llm, db, emit });

    const e3RoundIds = db.messages
      .filter((m) => m.panelMemberId === 'e3')
      .map((m) => m.roundId);
    expect(e3RoundIds).toContain('round-3');
  });

  it('共识提炼：关轮时触发，生成 ConsensusItem 与溯源 join', async () => {
    const members = makeMembers(4);
    const db = makeDb(members);
    const llm = makeLlm();
    setupLlmDefaults(llm);
    llm.extractConsensus.mockResolvedValue({
      items: [
        { type: 'consensus', content: '大家都认为 AI 重要', sources: ['e1 的观点'] },
        { type: 'divergence', content: '对取代时间表有分歧', sources: ['e2 的观点'] },
      ],
    });
    const { events, emit } = makeEvents();

    await runDiscussion('d1', { llm, db, emit });

    // 每轮关轮提炼一次（4 轮）
    expect(llm.extractConsensus).toHaveBeenCalledTimes(4);
    // 4 轮 × 2 条 = 8 条共识项
    expect(db.consensusItems).toHaveLength(8);
    // 反向匹配：每条 item 只链接 sources 命中的专家消息（每轮 2 条 × 各 1 个来源 = 4 轮 × 2 = 8）
    expect(db.consensusSources).toHaveLength(8);
    for (const src of db.consensusSources) {
      expect(db.messages.some((m) => m.id === src.messageId)).toBe(true);
    }
    // 溯源精确到指定专家：sources 含 'e1' 的 item 链接 e1 的消息
    const e1Linked = db.consensusSources.some((s) => {
      const msg = db.messages.find((m) => m.id === s.messageId);
      return msg?.panelMemberId === 'e1';
    });
    expect(e1Linked).toBe(true);
    // consensus_update 每轮触发
    expect(events.filter((e) => e.type === 'consensus_update')).toHaveLength(4);
  });

  it('SSE 事件：每步发对事件，status_update 与 speech 分离', async () => {
    const members = makeMembers(4);
    const db = makeDb(members);
    const llm = makeLlm();
    setupLlmDefaults(llm);
    const { events, emit } = makeEvents();

    await runDiscussion('d1', { llm, db, emit });

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('discussion_started');
    expect(types.at(-1)).toBe('discussion_finished');
    expect(types).toContain('speech_start');
    expect(types).toContain('speech_chunk');
    expect(types).toContain('speech_end');
    expect(types).toContain('status_update');
    expect(types).toContain('consensus_update');
    expect(types).toContain('discussion_summary');

    // status_update 是独立事件类型，覆盖 preparing / speaking / idle
    const statuses = new Set(
      events.filter((e) => e.type === 'status_update').map((e) => e.data.status),
    );
    expect(statuses).toContain('preparing');
    expect(statuses).toContain('speaking');
    expect(statuses).toContain('idle');

    // 一次发言内顺序：speech_start → speech_chunk → speech_end
    const firstStart = events.findIndex((e) => e.type === 'speech_start');
    const firstChunk = events.findIndex((e) => e.type === 'speech_chunk');
    const firstEnd = events.findIndex((e) => e.type === 'speech_end');
    expect(firstStart).toBeLessThan(firstChunk);
    expect(firstChunk).toBeLessThan(firstEnd);
  });

  it('边界：LLM 调用失败重试一次后成功', async () => {
    const members = makeMembers(4);
    const db = makeDb(members);
    const llm = makeLlm();
    // 第一次发言失败，重试成功
    llm.streamSpeech
      .mockRejectedValueOnce(new Error('临时网络错误'))
      .mockImplementation(async (_m: any, onChunk: (c: string) => void) => {
        onChunk('重试成功');
        return '重试成功';
      });
    llm.selectSpeakers.mockResolvedValue({ speakers: ['e1', 'e2'] });
    llm.extractConsensus.mockResolvedValue({ items: [] });
    const { events, emit } = makeEvents();

    await runDiscussion('d1', { llm, db, emit });

    expect(events.at(-1)?.type).toBe('discussion_finished');
    expect(db.finishDiscussion).toHaveBeenCalledTimes(1);
  });

  it('边界：超时 → 优雅结束（发 error + finished，不崩溃）', async () => {
    const members = makeMembers(4);
    const db = makeDb(members);
    const llm = makeLlm();
    const timeoutError = new Error('请求超时');
    timeoutError.name = 'AbortError';
    llm.streamSpeech.mockRejectedValue(timeoutError);
    llm.selectSpeakers.mockResolvedValue({ speakers: ['e1', 'e2'] });
    llm.extractConsensus.mockResolvedValue({ items: [] });
    const { events, emit } = makeEvents();

    await runDiscussion('d1', { llm, db, emit });

    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.at(-1)?.type).toBe('discussion_finished');
  });
});

describe('选人容错与每轮最低发言人数', () => {
  const expertMessagesIn = (db: any, roundId: string) =>
    db.messages.filter((m: any) => m.roundId === roundId);

  it('回归：第 2 轮选人返回名字 → 仍正常发言（2 条）', async () => {
    const members = makeNamedMembers(2);
    const db = makeDb(members);
    const llm = makeLlm();
    setupLlmDefaults(llm);
    llm.selectSpeakers
      .mockResolvedValueOnce({ speakers: ['e1', 'e2'] }) // 第 1 轮：ID
      .mockResolvedValueOnce({ speakers: ['专家1', '专家2'] }) // 第 2 轮：名字
      .mockResolvedValue({ speakers: [] });
    const { emit } = makeEvents();

    await runDiscussion('d1', { llm, db, emit });

    expect(expertMessagesIn(db, 'round-2')).toHaveLength(2);
  });

  it('回归：某轮返回 [] → 仍按最低人数补足（2 条）', async () => {
    const members = makeMembers(4);
    const db = makeDb(members);
    const llm = makeLlm();
    setupLlmDefaults(llm);
    llm.selectSpeakers
      .mockResolvedValueOnce({ speakers: ['e1', 'e2'] })
      .mockResolvedValueOnce({ speakers: [] })
      .mockResolvedValue({ speakers: ['e1', 'e2'] });
    const { emit } = makeEvents();

    await runDiscussion('d1', { llm, db, emit });

    expect(expertMessagesIn(db, 'round-2')).toHaveLength(2);
  });

  it('回归：某轮返回未知 ID → 仍按最低人数补足（2 条）', async () => {
    const members = makeMembers(4);
    const db = makeDb(members);
    const llm = makeLlm();
    setupLlmDefaults(llm);
    llm.selectSpeakers
      .mockResolvedValueOnce({ speakers: ['e1', 'e2'] })
      .mockResolvedValueOnce({ speakers: ['ghost', 'nobody'] })
      .mockResolvedValue({ speakers: ['e1', 'e2'] });
    const { emit } = makeEvents();

    await runDiscussion('d1', { llm, db, emit });

    expect(expertMessagesIn(db, 'round-2')).toHaveLength(2);
  });

  it('回归：第 1 轮就返回名字 → 仍有发言（2 条）', async () => {
    const members = makeNamedMembers(2);
    const db = makeDb(members);
    const llm = makeLlm();
    setupLlmDefaults(llm);
    llm.selectSpeakers.mockResolvedValue({ speakers: ['专家1', '专家2'] });
    const { emit } = makeEvents();

    await runDiscussion('d1', { llm, db, emit });

    expect(expertMessagesIn(db, 'round-1')).toHaveLength(2);
  });

  it('基线：4 专家 4 轮 → 专家发言总数 >= 8', async () => {
    const members = makeMembers(4);
    const db = makeDb(members);
    const llm = makeLlm();
    setupLlmDefaults(llm);
    const { emit } = makeEvents();

    await runDiscussion('d1', { llm, db, emit });

    const expertTotal = db.messages.filter((m: any) => Boolean(m.roundId)).length;
    expect(expertTotal).toBeGreaterThanOrEqual(8);
  });
});
