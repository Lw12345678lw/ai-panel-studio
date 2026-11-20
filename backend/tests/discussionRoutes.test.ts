// discussionRoutes.test.ts — TDD：SSE 路由层契约测试（createApp 尚未存在，预期全红）
// DB / LLM 全部用假实现；hub 用真实内存实现（无网络、无外部依赖）。
// 不启动真实 DeepSeek，不连真实 Prisma。
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app';
import { createSseHub } from '../src/services/sseHub';

// ===== 假 DB：内置一个 waiting 状态的讨论 + 主持人 + 2 专家 =====
function makeDb() {
  const discussion: any = {
    id: 'd1',
    topic: '测试话题',
    status: 'waiting',
    expertCount: 2,
    summary: null,
    finishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const members = [
    { id: 'host', discussionId: 'd1', name: '主持人', role: 'host', title: '主持', position: '控场', stance: '中立', color: '#111111', createdAt: new Date() },
    { id: 'e1', discussionId: 'd1', name: '张薇', role: 'expert', title: '专家', position: '乐观派', stance: 'AI 创造更多岗位', color: '#222222', createdAt: new Date() },
    { id: 'e2', discussionId: 'd1', name: '陈志强', role: 'expert', title: '专家', position: '悲观派', stance: 'AI 冲击就业', color: '#333333', createdAt: new Date() },
  ];
  let msgSeq = 0;
  let consSeq = 0;

  const db: any = {
    getDiscussion: vi.fn(async (id: string) => (id === discussion.id ? { ...discussion } : null)),
    getMembers: vi.fn(async () => members),
    claimDiscussion: vi.fn(async () => {
      if (discussion.status !== 'waiting') return false;
      discussion.status = 'ongoing';
      return true;
    }),
    createRound: vi.fn(async (d: any) => ({ id: `round-${d.seq}`, ...d, status: 'open' })),
    closeRound: vi.fn(async () => {}),
    createMessage: vi.fn(async (d: any) => ({ id: `msg-${++msgSeq}`, ...d })),
    createConsensusItem: vi.fn(async (d: any) => ({ id: `cons-${++consSeq}`, ...d })),
    createConsensusSource: vi.fn(async () => {}),
    finishDiscussion: vi.fn(async (_id: string, summary: string) => {
      discussion.status = 'finished';
      discussion.summary = summary;
      discussion.finishedAt = new Date();
    }),
    createDiscussion: vi.fn(),
    createPanelMember: vi.fn(),
  };

  return { db, discussion };
}

function makeLlm() {
  return {
    streamSpeech: vi.fn(async (_messages: any, onChunk: (chunk: string) => void) => {
      onChunk('发言');
      return '发言';
    }),
    selectSpeakers: vi.fn(async () => ({ speakers: ['e1', 'e2'] })),
    extractConsensus: vi.fn(async () => ({ items: [] })),
  };
}

// ===== 测试基建 =====
const servers: Server[] = [];

async function startApp(overrides: { db?: any; llm?: any; hub?: any } = {}) {
  const { db, discussion } = overrides.db ?? makeDb();
  const llm = overrides.llm ?? makeLlm();
  const hub = overrides.hub ?? createSseHub({ finishedTtlMs: 60_000 });
  const app = createApp({ db, llm, hub, config: { heartbeatMs: 60_000 } });
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { app, server, base, db, llm, hub, discussion };
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor 超时');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface Frame {
  id: number;
  event: string;
  data: string;
}

function parseFrame(raw: string): Frame | null {
  let id: number | undefined;
  let event: string | undefined;
  const data: string[] = [];
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue; // 忽略注释帧（心跳 / retry）
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '');
    if (field === 'id') id = Number(value);
    else if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (id === undefined || event === undefined) return null;
  return { id, event, data: data.join('\n') };
}

async function collectSse(
  res: Response,
  until = 'discussion_finished',
  timeoutMs = 8000,
): Promise<Frame[]> {
  if (!res.body) throw new Error('SSE 响应没有 body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const frames: Frame[] = [];
  let buffer = '';
  const deadline = Date.now() + timeoutMs;

  const readOnce = () =>
    new Promise<ReadableStreamReadResult<Uint8Array> | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()));
      reader.read().then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        () => {
          clearTimeout(timer);
          resolve({ done: true, value: undefined });
        },
      );
    });

  try {
    while (Date.now() <= deadline) {
      const result = await readOnce();
      if (!result || result.done) break;
      buffer += decoder.decode(result.value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const frame = parseFrame(raw);
        if (!frame) continue;
        frames.push(frame);
        if (frame.event === until) return frames;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return frames;
}

function openStream(base: string, id = 'd1', headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const response = fetch(`${base}/api/discussions/${id}/stream`, {
    headers,
    signal: controller.signal,
  });
  return { response, controller };
}

// ===== 用例 =====
describe('POST /api/discussions/:id/start', () => {
  it('讨论不存在 → 404', async () => {
    const { base, db } = await startApp();
    const res = await fetch(`${base}/api/discussions/missing/start`, { method: 'POST' });

    expect(res.status).toBe(404);
    expect(db.claimDiscussion).not.toHaveBeenCalled();
  });

  it('没有嘉宾阵容 → 409，且不抢占状态', async () => {
    const { base, db } = await startApp();
    db.getMembers.mockResolvedValueOnce([]);

    const res = await fetch(`${base}/api/discussions/d1/start`, { method: 'POST' });

    expect(res.status).toBe(409);
    expect(db.claimDiscussion).not.toHaveBeenCalled();
  });

  it('原子 claim 失败（已开始/已结束）→ 409', async () => {
    const { base, db } = await startApp();
    db.claimDiscussion.mockResolvedValueOnce(false);

    const res = await fetch(`${base}/api/discussions/d1/start`, { method: 'POST' });

    expect(res.status).toBe(409);
    expect(db.claimDiscussion).toHaveBeenCalledWith('d1');
    expect(db.createRound).not.toHaveBeenCalled();
  });

  it('成功：200 + status ongoing，claim 后异步拉起编排（响应不等待整场讨论）', async () => {
    const { base, db, discussion } = await startApp();

    const res = await fetch(`${base}/api/discussions/d1/start`, { method: 'POST' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('ongoing');
    expect(db.claimDiscussion).toHaveBeenCalledWith('d1');

    // 编排在响应之后继续跑：最终落库 finished
    await waitFor(() => discussion.status === 'finished');
    expect(db.createRound).toHaveBeenCalledTimes(2); // expertCount=2 → 2 轮
    expect(db.finishDiscussion).toHaveBeenCalledTimes(1);
    expect(discussion.summary).toBeTruthy();
  });

  it('重复 start → 第二次 409（不重复拉起）', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const llm = makeLlm();
    llm.streamSpeech.mockImplementation(async (_m: any, onChunk: (c: string) => void) => {
      await gate;
      onChunk('发言');
      return '发言';
    });
    const { base, db, discussion } = await startApp({ llm });

    const first = await fetch(`${base}/api/discussions/d1/start`, { method: 'POST' });
    expect(first.status).toBe(200);

    const second = await fetch(`${base}/api/discussions/d1/start`, { method: 'POST' });
    expect(second.status).toBe(409);
    expect(db.claimDiscussion).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => discussion.status === 'finished');
  });

  it('编排器抛错 → 流里发 error + discussion_finished，状态收敛为 finished', async () => {
    const llm = makeLlm();
    llm.streamSpeech.mockRejectedValue(new Error('模拟失败'));
    const { base, discussion } = await startApp({ llm });

    const { response } = openStream(base);
    const res = await response;
    const collecting = collectSse(res);

    const startRes = await fetch(`${base}/api/discussions/d1/start`, { method: 'POST' });
    expect(startRes.status).toBe(200);

    const frames = await collecting;
    const types = frames.map((f) => f.event);

    expect(types).toContain('error');
    expect(types.at(-1)).toBe('discussion_finished');
    expect(discussion.status).toBe('finished');
  });
});

describe('GET /api/discussions/:id/stream', () => {
  it('讨论不存在 → 404（不进入 SSE）', async () => {
    const { base } = await startApp();
    const res = await fetch(`${base}/api/discussions/missing/stream`);

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type') ?? '').toContain('application/json');
  });

  it('SSE 头正确，事件带 id/event/data 且顺序自洽', async () => {
    const { base } = await startApp();

    const { response } = openStream(base);
    const res = await response;
    expect(res.headers.get('content-type') ?? '').toContain('text/event-stream');
    expect(res.headers.get('cache-control') ?? '').toContain('no-cache');

    const collecting = collectSse(res);
    const startRes = await fetch(`${base}/api/discussions/d1/start`, { method: 'POST' });
    expect(startRes.status).toBe(200);

    const frames = await collecting;
    const types = frames.map((f) => f.event);

    expect(types[0]).toBe('discussion_started');
    expect(types.at(-1)).toBe('discussion_finished');
    expect(types).toContain('status_update');
    expect(types).toContain('speech_start');
    expect(types).toContain('speech_chunk');
    expect(types).toContain('speech_end');
    expect(types).toContain('consensus_update');
    expect(types).toContain('discussion_summary');

    // 每条事件 id 必须是数字且严格递增
    const ids = frames.map((f) => f.id);
    expect(ids.every((n) => Number.isInteger(n))).toBe(true);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));

    // data 必须是可解析 JSON
    for (const frame of frames) {
      expect(() => JSON.parse(frame.data)).not.toThrow();
    }

    // 一次发言内部的顺序：start → chunk → end
    const startIdx = types.indexOf('speech_start');
    const chunkIdx = types.indexOf('speech_chunk');
    const endIdx = types.indexOf('speech_end');
    expect(startIdx).toBeLessThan(chunkIdx);
    expect(chunkIdx).toBeLessThan(endIdx);
  });

  it('不带 Last-Event-ID 连入 → 全量回放（含已结束的讨论）', async () => {
    const { base, discussion } = await startApp();
    await fetch(`${base}/api/discussions/d1/start`, { method: 'POST' });
    await waitFor(() => discussion.status === 'finished');

    const { response } = openStream(base);
    const frames = await collectSse(await response);
    const types = frames.map((f) => f.event);

    expect(types[0]).toBe('discussion_started');
    expect(types.at(-1)).toBe('discussion_finished');
    expect(frames[0].id).toBe(1);
  });

  it('带 Last-Event-ID 连入 → 只回放增量', async () => {
    const { base, hub, discussion } = await startApp();
    await fetch(`${base}/api/discussions/d1/start`, { method: 'POST' });
    await waitFor(() => discussion.status === 'finished');

    const history = hub.replaySince('d1', 0);
    const started = history.find((e) => e.type === 'discussion_started')!;
    const lastId = started.id;

    const { response } = openStream(base, 'd1', { 'Last-Event-ID': String(lastId) });
    const frames = await collectSse(await response);

    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((f) => f.id > lastId)).toBe(true);
    expect(frames.some((f) => f.event === 'discussion_started')).toBe(false);
    expect(frames.at(-1)?.event).toBe('discussion_finished');
  });

  it('客户端断开 → subscriber 释放', async () => {
    const { base, hub } = await startApp();

    const { response, controller } = openStream(base);
    await response; // 等头返回
    await waitFor(() => hub.subscriberCount('d1') === 1);

    controller.abort();

    await waitFor(() => hub.subscriberCount('d1') === 0);
  });
});
