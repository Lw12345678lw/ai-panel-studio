// discussionListRoute.test.ts — TDD：GET /api/discussions 列表接口
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app';
import { createSseHub } from '../src/services/sseHub';

function makeDiscussion(overrides: Record<string, unknown>) {
  return {
    id: 'd1',
    topic: '话题',
    status: 'waiting',
    expertCount: 4,
    summary: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    finishedAt: null,
    ...overrides,
  };
}

const servers: Server[] = [];

async function startApp(discussions: any[]) {
  const db: any = { listDiscussions: vi.fn(async () => discussions) };
  const app = createApp({ db, hub: createSseHub(), llm: {} as any });
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('GET /api/discussions', () => {
  it('空列表 → 200 []', async () => {
    const base = await startApp([]);
    const res = await fetch(`${base}/api/discussions`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('按 createdAt 降序返回（即使数据源乱序）', async () => {
    const old = makeDiscussion({ id: 'old', createdAt: new Date('2026-01-01T00:00:00Z') });
    const newest = makeDiscussion({ id: 'newest', createdAt: new Date('2026-01-03T00:00:00Z') });
    const mid = makeDiscussion({ id: 'mid', createdAt: new Date('2026-01-02T00:00:00Z') });
    const base = await startApp([old, newest, mid]);

    const res = await fetch(`${base}/api/discussions`);
    const body = await res.json();

    expect(body.map((d: any) => d.id)).toEqual(['newest', 'mid', 'old']);
  });

  it('字段包含 id/topic/status/expertCount/createdAt/finishedAt/summary', async () => {
    const finishedAt = new Date('2026-01-02T00:00:00Z');
    const base = await startApp([
      makeDiscussion({
        id: 'd1',
        topic: 'AI 会取代人类工作吗？',
        status: 'finished',
        expertCount: 4,
        summary: '一句话总结',
        finishedAt,
      }),
    ]);

    const body = await (await fetch(`${base}/api/discussions`)).json();
    const item = body[0];

    expect(item).toMatchObject({
      id: 'd1',
      topic: 'AI 会取代人类工作吗？',
      status: 'finished',
      expertCount: 4,
      summary: '一句话总结',
    });
    expect(typeof item.createdAt).toBe('string');
    expect(item.finishedAt).toBe(finishedAt.toISOString());
  });

  it('summary 截断到 100 字（超出部分以省略号结尾），短 summary 原样返回', async () => {
    const longSummary = '甲'.repeat(150);
    const base = await startApp([
      makeDiscussion({ id: 'long', summary: longSummary }),
      makeDiscussion({ id: 'short', summary: '短总结', createdAt: new Date('2025-12-31T00:00:00Z') }),
    ]);

    const body = await (await fetch(`${base}/api/discussions`)).json();
    const long = body.find((d: any) => d.id === 'long');
    const short = body.find((d: any) => d.id === 'short');

    expect(long.summary).toBe(`${'甲'.repeat(100)}…`);
    expect(short.summary).toBe('短总结');
  });
});
