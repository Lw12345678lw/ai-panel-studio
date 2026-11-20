// discussionReadRoutes.test.ts — TDD：4 个只读 GET 路由（详情 / 成员 / 发言 / 共识）
// DB 全部 fake；不连 Prisma，不调 LLM。
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app';
import { createSseHub } from '../src/services/sseHub';

function makeDb() {
  const discussion = {
    id: 'd1',
    topic: '测试话题',
    status: 'ongoing',
    expertCount: 2,
    summary: null,
    finishedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  // 故意乱序：host 的 createdAt 晚于专家，验证「主持人优先」
  const members = [
    { id: 'e2', discussionId: 'd1', name: '专家二', role: 'expert', title: 't', position: 'p', stance: 's', color: '#222222', createdAt: new Date('2026-01-01T00:00:02Z') },
    { id: 'host', discussionId: 'd1', name: '主持人', role: 'host', title: 't', position: 'p', stance: 's', color: '#111111', createdAt: new Date('2026-01-01T00:00:03Z') },
    { id: 'e1', discussionId: 'd1', name: '专家一', role: 'expert', title: 't', position: 'p', stance: 's', color: '#333333', createdAt: new Date('2026-01-01T00:00:01Z') },
  ];

  // 故意乱序：验证按 createdAt 升序
  const messages = [
    { id: 'm2', discussionId: 'd1', panelMemberId: 'e1', roundId: 'r1', content: '后', type: 'speech', createdAt: new Date('2026-01-01T00:00:05Z'), panelMember: members[2] },
    { id: 'm1', discussionId: 'd1', panelMemberId: 'host', roundId: null, content: '先', type: 'speech', createdAt: new Date('2026-01-01T00:00:04Z'), panelMember: members[1] },
  ];

  const consensus = [
    { id: 'c2', discussionId: 'd1', type: 'divergence', content: '后', createdAt: new Date('2026-01-01T00:00:07Z'), updatedAt: new Date('2026-01-01T00:00:07Z'), sourceMessages: [{ consensusItemId: 'c2', messageId: 'm2' }] },
    { id: 'c1', discussionId: 'd1', type: 'consensus', content: '先', createdAt: new Date('2026-01-01T00:00:06Z'), updatedAt: new Date('2026-01-01T00:00:06Z'), sourceMessages: [{ consensusItemId: 'c1', messageId: 'm1' }, { consensusItemId: 'c1', messageId: 'm2' }] },
  ];

  return {
    db: {
      getDiscussion: vi.fn(async (id: string) => (id === 'd1' ? { ...discussion } : null)),
      getMembers: vi.fn(async () => members),
      getPanelMembers: vi.fn(async () => members),
      getMessages: vi.fn(async () => messages),
      getConsensus: vi.fn(async () => consensus),
      claimDiscussion: vi.fn(async () => false),
      createDiscussion: vi.fn(),
      createPanelMember: vi.fn(),
      createRound: vi.fn(),
      closeRound: vi.fn(),
      createMessage: vi.fn(),
      createConsensusItem: vi.fn(),
      createConsensusSource: vi.fn(),
      finishDiscussion: vi.fn(),
      finishStaleOngoing: vi.fn(),
    },
  };
}

const servers: Server[] = [];

async function startApp(db: any = makeDb().db) {
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

describe('GET /api/discussions/:id', () => {
  it('存在 → 200 返回讨论', async () => {
    const base = await startApp();
    const res = await fetch(`${base}/api/discussions/d1`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe('d1');
    expect(body.status).toBe('ongoing');
  });

  it('不存在 → 404', async () => {
    const base = await startApp();
    const res = await fetch(`${base}/api/discussions/missing`);

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('讨论不存在');
  });
});

describe('GET /api/discussions/:id/members', () => {
  it('不存在 → 404', async () => {
    const base = await startApp();
    const res = await fetch(`${base}/api/discussions/missing/members`);

    expect(res.status).toBe(404);
  });

  it('空列表 → 200 []', async () => {
    const { db } = makeDb();
    db.getPanelMembers.mockResolvedValueOnce([]);
    const base = await startApp(db);
    const res = await fetch(`${base}/api/discussions/d1/members`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('排序：主持人优先，其余按 createdAt 升序', async () => {
    const base = await startApp();
    const res = await fetch(`${base}/api/discussions/d1/members`);
    const body = await res.json();

    expect(body.map((m: any) => m.id)).toEqual(['host', 'e1', 'e2']);
  });
});

describe('GET /api/discussions/:id/messages', () => {
  it('不存在 → 404', async () => {
    const base = await startApp();
    const res = await fetch(`${base}/api/discussions/missing/messages`);

    expect(res.status).toBe(404);
  });

  it('空列表 → 200 []', async () => {
    const { db } = makeDb();
    db.getMessages.mockResolvedValueOnce([]);
    const base = await startApp(db);
    const res = await fetch(`${base}/api/discussions/d1/messages`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('按 createdAt 升序，且带 panelMember', async () => {
    const base = await startApp();
    const res = await fetch(`${base}/api/discussions/d1/messages`);
    const body = await res.json();

    expect(body.map((m: any) => m.id)).toEqual(['m1', 'm2']);
    expect(body[0].panelMember.id).toBe('host');
  });
});

describe('GET /api/discussions/:id/consensus', () => {
  it('不存在 → 404', async () => {
    const base = await startApp();
    const res = await fetch(`${base}/api/discussions/missing/consensus`);

    expect(res.status).toBe(404);
  });

  it('空列表 → 200 []', async () => {
    const { db } = makeDb();
    db.getConsensus.mockResolvedValueOnce([]);
    const base = await startApp(db);
    const res = await fetch(`${base}/api/discussions/d1/consensus`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('按 createdAt 升序，并把 join 行映射为 sourceMessageIds', async () => {
    const base = await startApp();
    const res = await fetch(`${base}/api/discussions/d1/consensus`);
    const body = await res.json();

    expect(body.map((c: any) => c.id)).toEqual(['c1', 'c2']);
    expect(body[0].sourceMessageIds).toEqual(['m1', 'm2']);
    expect(body[1].sourceMessageIds).toEqual(['m2']);
    expect(body[0].sourceMessages).toBeUndefined();
  });
});
