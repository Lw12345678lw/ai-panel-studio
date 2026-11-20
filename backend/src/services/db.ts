// db.ts — 应用层数据访问：同时满足 orchestrator 的 DiscussionDb 与路由层需求。
import type { Discussion, PanelMember, Prisma } from '@prisma/client';
import { prisma } from '../db';
import type { DiscussionDb, Member } from './orchestrator';

export type MessageWithMember = Prisma.MessageGetPayload<{ include: { panelMember: true } }>;
export type ConsensusWithSources = Prisma.ConsensusItemGetPayload<{
  include: { sourceMessages: true };
}>;

export interface AppDb extends DiscussionDb {
  listDiscussions(): Promise<Discussion[]>;
  getPanelMembers(discussionId: string): Promise<PanelMember[]>;
  getMessages(discussionId: string): Promise<MessageWithMember[]>;
  getConsensus(discussionId: string): Promise<ConsensusWithSources[]>;
  createDiscussion(data: { topic: string; expertCount: number }): Promise<Discussion>;
  createPanelMember(data: {
    discussionId: string;
    name: string;
    role: string;
    title: string;
    position: string;
    stance: string;
    color: string;
  }): Promise<PanelMember>;
  /** 阵容生成完成：generating → waiting（仅当仍处于 generating） */
  markPanelReady(id: string): Promise<void>;
  /** 原子抢占：仅当 status=waiting 时置为 ongoing；返回是否抢占成功 */
  claimDiscussion(id: string): Promise<boolean>;
  /** 启动时收敛残留的 ongoing（进程重启后内存编排已丢失） */
  finishStaleOngoing(): Promise<number>;
}

export const appDb: AppDb = {
  listDiscussions: async () =>
    prisma.discussion.findMany({ orderBy: { createdAt: 'desc' } }),

  getDiscussion: async (id) => prisma.discussion.findUnique({ where: { id } }),

  // orchestrator 只窄接口需要：role 收敛为 host | expert
  getMembers: async (discussionId) => {
    const rows = await prisma.panelMember.findMany({
      where: { discussionId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(
      (m): Member => ({
        id: m.id,
        role: m.role === 'host' ? 'host' : 'expert',
        name: m.name,
        title: m.title,
        position: m.position,
        stance: m.stance,
        color: m.color,
      }),
    );
  },

  getPanelMembers: async (discussionId) =>
    prisma.panelMember.findMany({ where: { discussionId }, orderBy: { createdAt: 'asc' } }),

  getMessages: async (discussionId) =>
    prisma.message.findMany({
      where: { discussionId },
      orderBy: { createdAt: 'asc' },
      include: { panelMember: true },
    }),

  getConsensus: async (discussionId) =>
    prisma.consensusItem.findMany({
      where: { discussionId },
      orderBy: { createdAt: 'asc' },
      include: { sourceMessages: true },
    }),

  createDiscussion: async (data) => prisma.discussion.create({ data }),

  createPanelMember: async (data) => prisma.panelMember.create({ data }),

  markPanelReady: async (id) => {
    await prisma.discussion.updateMany({
      where: { id, status: 'generating' },
      data: { status: 'waiting' },
    });
  },

  claimDiscussion: async (id) => {
    const result = await prisma.discussion.updateMany({
      where: { id, status: 'waiting' },
      data: { status: 'ongoing' },
    });
    return result.count === 1;
  },

  // 启动收敛：重启后内存中的编排已丢失，把残留 ongoing 记为 finished。
  // seed- 前缀是演示数据（含一场刻意 ongoing 的示例），不参与收敛。
  finishStaleOngoing: async () => {
    const result = await prisma.discussion.updateMany({
      where: { status: 'ongoing', NOT: { id: { startsWith: 'seed-' } } },
      data: { status: 'finished', finishedAt: new Date() },
    });
    return result.count;
  },

  createRound: async (data) => prisma.round.create({ data }),

  closeRound: async (roundId) => {
    await prisma.round.update({ where: { id: roundId }, data: { status: 'closed' } });
  },

  createMessage: async (data) => prisma.message.create({ data }),

  createConsensusItem: async (data) => prisma.consensusItem.create({ data }),

  createConsensusSource: async (data) => {
    await prisma.consensusItemMessage.create({ data });
  },

  finishDiscussion: async (id, summary) => {
    await prisma.discussion.update({
      where: { id },
      data: { status: 'finished', summary, finishedAt: new Date() },
    });
  },
};
