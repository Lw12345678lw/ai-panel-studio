import { Router } from 'express';
import type { AppDb } from '../services/db';
import { generatePanel, PanelGenerationError } from '../services/panelService';
import { runDiscussion, type LlmClient } from '../services/orchestrator';
import type { HubEvent, SseHub } from '../services/sseHub';

export interface DiscussionsRouterDeps {
  db: AppDb;
  llm: LlmClient;
  hub: SseHub;
  config?: { heartbeatMs?: number };
}

function sortByCreatedAt<T extends { createdAt: Date | string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

// 主持人优先，其余按创建时间升序（稳定排序，时间相同保持 DB 顺序）
function sortMembers<T extends { role: string; createdAt: Date | string }>(members: T[]): T[] {
  return [...members].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'host' ? -1 : 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

const SUMMARY_LIMIT = 100;

function truncateSummary(summary: string | null | undefined): string | null {
  if (!summary) return null;
  return summary.length > SUMMARY_LIMIT ? `${summary.slice(0, SUMMARY_LIMIT)}…` : summary;
}

export function createDiscussionsRouter({ db, llm, hub, config }: DiscussionsRouterDeps): Router {
  const router = Router();
  const heartbeatMs = config?.heartbeatMs ?? 15_000;
  // 防重入的第二道保险（唯一真相仍是 DB 的原子 claim）
  const activeRuns = new Map<string, Promise<void>>();

  // POST /api/discussions — 创建讨论
  router.post('/', async (req, res) => {
    const topic = req.body?.topic;
    const expertCount = req.body?.expertCount;

    if (typeof topic !== 'string' || !topic.trim()) {
      res.status(400).json({ error: 'topic 不能为空' });
      return;
    }
    if (
      typeof expertCount !== 'number' ||
      !Number.isInteger(expertCount) ||
      expertCount < 2 ||
      expertCount > 8
    ) {
      res.status(400).json({ error: 'expertCount 必须是 2~8 的整数' });
      return;
    }

    const discussion = await db.createDiscussion({ topic: topic.trim(), expertCount });
    res.status(201).json(discussion);
  });

  // POST /api/discussions/:id/generate-panel — 生成嘉宾阵容（同步接口，耗时约 10~25 秒）
  router.post('/:id/generate-panel', async (req, res) => {
    const { id } = req.params;

    const discussion = await db.getDiscussion(id);
    if (!discussion) {
      res.status(404).json({ error: '讨论不存在' });
      return;
    }

    // 幂等：已有嘉宾则直接返回，避免重复生成与重复落库
    const existing = await db.getPanelMembers(id);
    if (existing.length > 0) {
      res.json(existing);
      return;
    }

    try {
      const generated = await generatePanel(discussion.topic, discussion.expertCount);
      const members = await Promise.all(
        generated.map((m) =>
          db.createPanelMember({
            discussionId: id,
            name: m.name,
            role: m.role,
            title: m.title,
            position: m.position,
            stance: m.stance,
            color: m.color,
          }),
        ),
      );
      res.status(201).json(members);
    } catch (e) {
      if (e instanceof PanelGenerationError) {
        res.status(502).json({ error: e.message });
      } else {
        res.status(500).json({ error: '生成嘉宾阵容失败' });
      }
    }
  });

  // POST /api/discussions/:id/start — 原子抢占状态后异步拉起编排器
  router.post('/:id/start', async (req, res) => {
    const { id } = req.params;

    const discussion = await db.getDiscussion(id);
    if (!discussion) {
      res.status(404).json({ error: '讨论不存在' });
      return;
    }

    const members = await db.getMembers(id);
    const host = members.find((m) => m.role === 'host');
    const experts = members.filter((m) => m.role === 'expert');
    if (!host || experts.length < 2) {
      res.status(409).json({ error: '请先生成嘉宾阵容' });
      return;
    }

    if (activeRuns.has(id)) {
      res.status(409).json({ error: '讨论已开始或已结束' });
      return;
    }

    // 原子 claim：并发 start 只有一个能成功（跨进程也成立）
    const claimed = await db.claimDiscussion(id);
    if (!claimed) {
      res.status(409).json({ error: '讨论已开始或已结束' });
      return;
    }

    const started = (await db.getDiscussion(id)) ?? { ...discussion, status: 'ongoing' };

    const run: Promise<void> = runDiscussion(id, {
      llm,
      db,
      emit: (event) => hub.publish(id, event),
    }).catch(async (e) => {
      // runDiscussion 内部已兜底运行期错误；这里兜住初始化阶段抛错（如成员缺失）
      const message = e instanceof Error ? e.message : String(e);
      try {
        await db.finishDiscussion(id, '讨论因错误提前结束');
      } catch {
        /* 收尾失败不掩盖原始错误 */
      }
      hub.publish(id, { type: 'error', data: { message } });

      let fresh: unknown = null;
      try {
        fresh = await db.getDiscussion(id);
      } catch {
        /* 忽略 */
      }
      hub.publish(id, { type: 'discussion_finished', data: { discussion: fresh } });
    });

    activeRuns.set(id, run);
    void run.finally(() => activeRuns.delete(id));

    res.status(200).json(started);
  });

  // GET /api/discussions/:id/stream — SSE 通道：回放 + 实时广播 + 心跳
  router.get('/:id/stream', async (req, res) => {
    const { id } = req.params;

    const discussion = await db.getDiscussion(id);
    if (!discussion) {
      res.status(404).json({ error: '讨论不存在' });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('retry: 3000\n\n');

    const writeEvent = (event: HubEvent) => {
      res.write(
        `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
      );
    };

    // 先订阅、再回放：同一 tick 内不会有事件插队，避免漏发/重发
    const unsubscribe = hub.subscribe(id, writeEvent);

    const rawLastId = req.headers['last-event-id'];
    const parsedLastId = typeof rawLastId === 'string' ? Number.parseInt(rawLastId, 10) : 0;
    const lastEventId = Number.isFinite(parsedLastId) ? parsedLastId : 0;
    const replayed = hub.replaySince(id, lastEventId);
    for (const event of replayed) writeEvent(event);

    // 服务重启后 history 已丢失但讨论已结束：合成结束事件，便于前端收尾
    if (discussion.status === 'finished' && replayed.length === 0) {
      res.write(
        `event: discussion_finished\ndata: ${JSON.stringify({ discussion })}\n\n`,
      );
    }

    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* 连接已断开，close 事件会清理 */
      }
    }, heartbeatMs);
    heartbeat.unref?.();

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on('close', cleanup);
    res.on('error', cleanup);
  });

  // GET /api/discussions — 讨论列表（createdAt 降序，summary 截断 100 字）
  router.get('/', async (_req, res) => {
    const discussions = await db.listDiscussions();
    const items = [...discussions]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((discussion) => ({
        id: discussion.id,
        topic: discussion.topic,
        status: discussion.status,
        expertCount: discussion.expertCount,
        createdAt: discussion.createdAt,
        updatedAt: discussion.updatedAt,
        finishedAt: discussion.finishedAt,
        summary: truncateSummary(discussion.summary),
      }));
    res.json(items);
  });

  // GET /api/discussions/:id/members — 嘉宾列表（主持人优先）
  router.get('/:id/members', async (req, res) => {
    const { id } = req.params;
    const discussion = await db.getDiscussion(id);
    if (!discussion) {
      res.status(404).json({ error: '讨论不存在' });
      return;
    }
    const members = await db.getPanelMembers(id);
    res.json(sortMembers(members));
  });

  // GET /api/discussions/:id/messages — 发言记录（createdAt 升序，含 panelMember）
  router.get('/:id/messages', async (req, res) => {
    const { id } = req.params;
    const discussion = await db.getDiscussion(id);
    if (!discussion) {
      res.status(404).json({ error: '讨论不存在' });
      return;
    }
    const messages = await db.getMessages(id);
    res.json(sortByCreatedAt(messages));
  });

  // GET /api/discussions/:id/consensus — 共识/分歧（含 sourceMessageIds）
  router.get('/:id/consensus', async (req, res) => {
    const { id } = req.params;
    const discussion = await db.getDiscussion(id);
    if (!discussion) {
      res.status(404).json({ error: '讨论不存在' });
      return;
    }
    const rows = sortByCreatedAt(await db.getConsensus(id));
    res.json(
      rows.map(({ sourceMessages, ...item }) => ({
        ...item,
        sourceMessageIds: sourceMessages.map((source) => source.messageId),
      })),
    );
  });

  // GET /api/discussions/:id — 讨论详情
  router.get('/:id', async (req, res) => {
    const discussion = await db.getDiscussion(req.params.id);
    if (!discussion) {
      res.status(404).json({ error: '讨论不存在' });
      return;
    }
    res.json(discussion);
  });

  return router;
}
