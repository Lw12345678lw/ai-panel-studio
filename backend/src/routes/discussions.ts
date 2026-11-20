import { Router } from 'express';
import { prisma } from '../db';
import { generatePanel, PanelGenerationError } from '../services/panelService';

export const discussionsRouter = Router();

// POST /api/discussions — 创建讨论
discussionsRouter.post('/', async (req, res) => {
  const topic = req.body?.topic;
  const expertCount = req.body?.expertCount;

  if (typeof topic !== 'string' || !topic.trim()) {
    res.status(400).json({ error: 'topic 不能为空' });
    return;
  }
  if (typeof expertCount !== 'number' || !Number.isInteger(expertCount) || expertCount < 2 || expertCount > 8) {
    res.status(400).json({ error: 'expertCount 必须是 2~8 的整数' });
    return;
  }

  const discussion = await prisma.discussion.create({
    data: { topic: topic.trim(), expertCount },
  });
  res.status(201).json(discussion);
});

// POST /api/discussions/:id/generate-panel — 生成嘉宾阵容（同步接口，耗时约 10~25 秒）
discussionsRouter.post('/:id/generate-panel', async (req, res) => {
  const { id } = req.params;

  const discussion = await prisma.discussion.findUnique({ where: { id } });
  if (!discussion) {
    res.status(404).json({ error: '讨论不存在' });
    return;
  }

  // 幂等：已有嘉宾则直接返回，避免重复生成与重复落库
  const existing = await prisma.panelMember.findMany({
    where: { discussionId: id },
    orderBy: { createdAt: 'asc' },
  });
  if (existing.length > 0) {
    res.json(existing);
    return;
  }

  try {
    const generated = await generatePanel(discussion.topic, discussion.expertCount);
    const members = await Promise.all(
      generated.map((m) =>
        prisma.panelMember.create({
          data: {
            discussionId: id,
            name: m.name,
            role: m.role,
            title: m.title,
            position: m.position,
            stance: m.stance,
            color: m.color,
          },
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
