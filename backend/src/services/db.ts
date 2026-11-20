// db.ts — 编排器需要的数据库操作（封装 Prisma，供 orchestrator 依赖注入使用）
import { prisma } from '../db';

export const orchestrationDb = {
  getDiscussion: (id: string) => prisma.discussion.findUnique({ where: { id } }),

  getMembers: (discussionId: string) =>
    prisma.panelMember.findMany({ where: { discussionId }, orderBy: { createdAt: 'asc' } }),

  createRound: (data: { discussionId: string; seq: number; question: string }) =>
    prisma.round.create({ data }),

  closeRound: (roundId: string) =>
    prisma.round.update({ where: { id: roundId }, data: { status: 'closed' } }),

  createMessage: (data: {
    discussionId: string;
    panelMemberId: string;
    roundId: string | null;
    content: string;
    type: string;
  }) => prisma.message.create({ data }),

  createConsensusItem: (data: { discussionId: string; type: string; content: string }) =>
    prisma.consensusItem.create({ data }),

  // 溯源 join：ConsensusItemMessage（共识项 ↔ 来源发言）
  createConsensusSource: (data: { consensusItemId: string; messageId: string }) =>
    prisma.consensusItemMessage.create({ data }),

  finishDiscussion: (id: string, summary: string) =>
    prisma.discussion.update({
      where: { id },
      data: { status: 'finished', summary, finishedAt: new Date() },
    }),
};
