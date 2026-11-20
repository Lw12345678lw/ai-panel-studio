// seed.ts — 示例数据：2 场完整讨论（finished / ongoing）+ 3 条轻量讨论（≥5 条）
// 幂等：每次先删除固定 seed id 的旧数据，再重建。
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SEED_IDS = [
  'seed-ai-jobs-finished',
  'seed-remote-work-ongoing',
  'seed-housing-waiting',
  'seed-ev-generating',
  'seed-ai-education-finished',
];

type MemberSeed = {
  key: string;
  role: 'host' | 'expert';
  name: string;
  title: string;
  position: string;
  stance: string;
  color: string;
};

type RoundSeed = {
  seq: number;
  question: string;
  status: 'open' | 'closed';
  speeches: { member: string; content: string }[];
};

type ConsensusSeed = {
  type: 'consensus' | 'divergence';
  content: string;
  sourceMessageIds: string[];
};

type FullSeed = {
  id: string;
  topic: string;
  status: 'finished' | 'ongoing';
  expertCount: number;
  summary: string | null;
  createdAt: string;
  finishedAt: string | null;
  members: MemberSeed[];
  rounds: RoundSeed[];
  consensus: ConsensusSeed[];
};

async function seedFull(seed: FullSeed): Promise<void> {
  const base = new Date(seed.createdAt).getTime();

  await prisma.discussion.create({
    data: {
      id: seed.id,
      topic: seed.topic,
      status: seed.status,
      expertCount: seed.expertCount,
      summary: seed.summary,
      createdAt: new Date(base),
      finishedAt: seed.finishedAt ? new Date(seed.finishedAt) : null,
    },
  });

  const memberId = new Map<string, string>();
  for (let i = 0; i < seed.members.length; i++) {
    const member = seed.members[i];
    const id = `${seed.id}-member-${member.key}`;
    memberId.set(member.key, id);
    await prisma.panelMember.create({
      data: {
        id,
        discussionId: seed.id,
        name: member.name,
        role: member.role,
        title: member.title,
        position: member.position,
        stance: member.stance,
        color: member.color,
        createdAt: new Date(base + i * 1000),
      },
    });
  }

  const hostId = memberId.get('host');
  if (!hostId) throw new Error(`seed ${seed.id} 缺少 host`);

  // 主持人开场
  await prisma.message.create({
    data: {
      id: `${seed.id}-host-open`,
      discussionId: seed.id,
      panelMemberId: hostId,
      roundId: null,
      content: `欢迎来到本场圆桌。今天讨论的话题是「${seed.topic}」。请各位先给出明确判断，再回应彼此的观点。`,
      type: 'speech',
      createdAt: new Date(base + 30_000),
    },
  });

  let cursor = base + 60_000;

  for (const round of seed.rounds) {
    const roundId = `${seed.id}-round-${round.seq}`;

    // 主持人抛子问题（真实实现中开轮前发言，roundId 为空）
    await prisma.message.create({
      data: {
        id: `${roundId}-question`,
        discussionId: seed.id,
        panelMemberId: hostId,
        roundId: null,
        content: round.question,
        type: 'speech',
        createdAt: new Date(cursor - 2000),
      },
    });

    await prisma.round.create({
      data: {
        id: roundId,
        discussionId: seed.id,
        seq: round.seq,
        question: round.question,
        status: round.status,
        createdAt: new Date(cursor),
      },
    });

    cursor += 10_000;

    for (let i = 0; i < round.speeches.length; i++) {
      const speech = round.speeches[i];
      const speakerId = memberId.get(speech.member);
      if (!speakerId) throw new Error(`seed ${seed.id} 未知成员 ${speech.member}`);
      await prisma.message.create({
        data: {
          id: `${roundId}-msg-${i + 1}`,
          discussionId: seed.id,
          panelMemberId: speakerId,
          roundId,
          content: speech.content,
          type: 'speech',
          createdAt: new Date(cursor + i * 15_000),
        },
      });
    }

    cursor += round.speeches.length * 15_000 + 20_000;
  }

  for (let i = 0; i < seed.consensus.length; i++) {
    const item = seed.consensus[i];
    const itemId = `${seed.id}-consensus-${i + 1}`;

    await prisma.consensusItem.create({
      data: {
        id: itemId,
        discussionId: seed.id,
        type: item.type,
        content: item.content,
        createdAt: new Date(cursor + i * 2000),
      },
    });

    for (const messageId of item.sourceMessageIds) {
      const exists = await prisma.message.findUnique({ where: { id: messageId } });
      if (!exists) throw new Error(`seed ${seed.id} 溯源引用了不存在的消息 ${messageId}`);
      await prisma.consensusItemMessage.create({
        data: { consensusItemId: itemId, messageId },
      });
    }
  }

  if (seed.summary) {
    await prisma.message.create({
      data: {
        id: `${seed.id}-summary`,
        discussionId: seed.id,
        panelMemberId: hostId,
        roundId: null,
        content: seed.summary,
        type: 'summary',
        createdAt: new Date(cursor + 60_000),
      },
    });
  }
}

// ===== 讨论 1：finished，完整 4 轮 =====
const AI_JOBS: FullSeed = {
  id: 'seed-ai-jobs-finished',
  topic: 'AI 会取代人类工作吗？',
  status: 'finished',
  expertCount: 4,
  summary:
    '本场讨论逐步收敛：先被冲击的是可拆解、可验证的白领任务，而非流水线体力活；真正的风险是替代速度与新岗位创造速度之间的错配。争论集中在两点：岗位总量是否净减少、制度兜底应覆盖到什么程度。多数观点认为，再培训必须转向「人机协作」，而不是与模型比拼记忆与写作速度。',
  createdAt: '2026-11-18T10:00:00.000Z',
  finishedAt: '2026-11-18T10:30:00.000Z',
  members: [
    { key: 'host', role: 'host', name: '陈立衡', title: '科技圆桌主持人', position: '某智库', stance: '中立控场，负责追问与串联', color: '#6366F1' },
    { key: 'zhou', role: 'expert', name: '周牧之', title: 'AI 经济学家', position: '某大学经济学院', stance: '十年内 AI 将实质替代三分之一以上的常规岗位', color: '#EF4444' },
    { key: 'lin', role: 'expert', name: '林晓岚', title: '技术史研究者', position: '某科技研究院', stance: '历次技术革命创造的岗位都多于消灭的岗位', color: '#10B981' },
    { key: 'zhao', role: 'expert', name: '赵启明', title: '组织变革顾问', position: '某咨询公司', stance: '被取代的是任务而非职业，人机协作是主流形态', color: '#3B82F6' },
    { key: 'wu', role: 'expert', name: '吴思远', title: '平台经济学者', position: '某高校公共政策学院', stance: '分配失衡比失业本身更危险', color: '#F59E0B' },
  ],
  rounds: [
    {
      seq: 1,
      question: 'AI 最先冲击的是流水线工人，还是办公室白领？',
      status: 'closed',
      speeches: [
        { member: 'zhou', content: '先被替代的是可标准化的白领任务：文案、客服、初级代码。它们的产出是纯信息，模型复制成本几乎为零。' },
        { member: 'lin', content: '我不同意把流水线排在后面。制造业自动化早就在发生，真正的新变量是白领任务第一次变得可被机器批量生产。' },
        { member: 'zhao', content: '两位其实说的是同一件事的两个面：被替代的单位不是职业，而是任务包。白领的任务更容易被拆解，所以先中枪。' },
      ],
    },
    {
      seq: 2,
      question: '如果被替代的是任务，岗位总量会因此减少吗？',
      status: 'closed',
      speeches: [
        { member: 'lin', content: '历次技术革命最终创造的岗位都多于消灭的岗位，AI 也不会例外；真正的风险是政策误判导致的恐慌。' },
        { member: 'zhou', content: '这次不同的是替代速度。新岗位的创造周期以年计，被替代的周期以月计，中间的错配就是结构性失业。' },
        { member: 'wu', content: '总量之争容易掩盖分配问题。即使岗位总量不减少，收益集中在少数平台，也会造成严重的社会失衡。' },
      ],
    },
    {
      seq: 3,
      question: '再培训能接住被挤出的中等技能白领吗？',
      status: 'closed',
      speeches: [
        { member: 'zhao', content: '再培训是必要的，但课程必须围绕「人机协作」，而不是教人跟模型比记忆和写作速度。' },
        { member: 'zhou', content: '我不乐观。新技能还没学完，模型又迭代了一代，培训体系永远慢半拍。' },
      ],
    },
    {
      seq: 4,
      question: '制度应该兜底到什么程度？',
      status: 'closed',
      speeches: [
        { member: 'wu', content: '制度至少要兜住转型期的时间和基本收入，否则分配失衡会先于失业问题爆发。' },
        { member: 'lin', content: '兜底要精准，不能把再培训的成本全部转嫁给企业，否则会抑制新岗位的创造。' },
      ],
    },
  ],
  consensus: [
    {
      type: 'consensus',
      content: '先被冲击的是可拆解、可验证的白领任务，而非流水线体力活。',
      sourceMessageIds: [
        'seed-ai-jobs-finished-round-1-msg-1',
        'seed-ai-jobs-finished-round-1-msg-2',
      ],
    },
    {
      type: 'consensus',
      content: '各方都认为转型期的技能错配是核心风险。',
      sourceMessageIds: [
        'seed-ai-jobs-finished-round-2-msg-2',
        'seed-ai-jobs-finished-round-3-msg-1',
      ],
    },
    {
      type: 'consensus',
      content: '再培训需要围绕人机协作重构，而不是与模型比拼记忆。',
      sourceMessageIds: ['seed-ai-jobs-finished-round-3-msg-1'],
    },
    {
      type: 'divergence',
      content: '岗位总量是否会净减少：周牧之认为会，林晓岚认为不会。',
      sourceMessageIds: [
        'seed-ai-jobs-finished-round-1-msg-2',
        'seed-ai-jobs-finished-round-2-msg-2',
      ],
    },
    {
      type: 'divergence',
      content: '兜底责任应落在制度还是个人与企业：吴思远主张制度兜底，林晓岚强调精准且不抑制创造。',
      sourceMessageIds: [
        'seed-ai-jobs-finished-round-4-msg-1',
        'seed-ai-jobs-finished-round-4-msg-2',
      ],
    },
  ],
};

// ===== 讨论 2：ongoing，第 4 轮 open，无总结 =====
const REMOTE_WORK: FullSeed = {
  id: 'seed-remote-work-ongoing',
  topic: '远程办公是未来趋势吗？',
  status: 'ongoing',
  expertCount: 4,
  summary: null,
  createdAt: '2026-11-19T14:00:00.000Z',
  finishedAt: null,
  members: [
    { key: 'host', role: 'host', name: '沈知远', title: '职场话题主持人', position: '某商业媒体', stance: '中立控场，负责追问与串联', color: '#8B5CF6' },
    { key: 'gu', role: 'expert', name: '顾清和', title: '组织行为学研究者', position: '某商学院', stance: '混合办公是人才市场的结构性变化', color: '#06B6D4' },
    { key: 'xu', role: 'expert', name: '许南舟', title: '协作工具创业者', position: '某 SaaS 公司', stance: '远程只适合任务边界清晰的团队', color: '#EC4899' },
    { key: 'han', role: 'expert', name: '韩雪', title: '劳动法学者', position: '某政法大学', stance: '远程把协调成本转嫁给了员工', color: '#84CC16' },
    { key: 'lu', role: 'expert', name: '陆行舟', title: '工程管理者', position: '某科技公司', stance: '关键变量是管理方式，不是办公地点', color: '#F97316' },
  ],
  rounds: [
    {
      seq: 1,
      question: '远程办公提高效率，还是侵蚀协作？',
      status: 'closed',
      speeches: [
        { member: 'gu', content: '远程把通勤时间还给了员工，专注型工作的效率确实提升了，但跨部门协作的隐性成本被低估了。' },
        { member: 'xu', content: '我反对一刀切。知识密集、任务边界清晰的团队适合远程；需要快速试错的团队，线下密度仍然不可替代。' },
      ],
    },
    {
      seq: 2,
      question: '混合办公会成为默认形态吗？',
      status: 'closed',
      speeches: [
        { member: 'han', content: '混合办公已经是多数科技公司的默认选项，但它把协调成本转嫁成了员工的时间碎片。' },
        { member: 'lu', content: '真正的变量不是办公地点，而是管理方式。如果还用考勤思维管理远程，混合只会变成两头不讨好。' },
        { member: 'gu', content: '从人才市场看，远程选项扩大了招聘半径，中小城市的人才第一次能和一线城市同台竞争。' },
      ],
    },
    {
      seq: 3,
      question: '远程办公会拉大还是缩小城市差距？',
      status: 'closed',
      speeches: [
        { member: 'xu', content: '短期缩小机会差距，长期可能加剧核心城市的集聚，因为高价值协作仍然需要面对面。' },
        { member: 'han', content: '我倾向于缩小。企业开始按岗位而非地点定薪，这会慢慢削弱一线城市的溢价。' },
      ],
    },
    {
      seq: 4,
      question: '如果让你给团队一条远程协作规则，会是什么？',
      status: 'open',
      speeches: [
        { member: 'lu', content: '异步优先：默认所有讨论都有书面记录，会议只用于真正需要碰撞的决策。' },
        { member: 'gu', content: '我补一条：每周至少一次深度对齐，专门处理分歧，不要让它沉在聊天记录里。' },
      ],
    },
  ],
  consensus: [
    {
      type: 'consensus',
      content: '远程办公对专注型任务提升明显，但协作成本被低估。',
      sourceMessageIds: [
        'seed-remote-work-ongoing-round-1-msg-1',
        'seed-remote-work-ongoing-round-1-msg-2',
      ],
    },
    {
      type: 'consensus',
      content: '混合办公已是多数知识型团队的默认形态。',
      sourceMessageIds: [
        'seed-remote-work-ongoing-round-2-msg-1',
        'seed-remote-work-ongoing-round-2-msg-3',
      ],
    },
    {
      type: 'divergence',
      content: '远程会拉大还是缩小城市差距：许南舟偏悲观，韩雪偏乐观。',
      sourceMessageIds: [
        'seed-remote-work-ongoing-round-3-msg-1',
        'seed-remote-work-ongoing-round-3-msg-2',
      ],
    },
    {
      type: 'divergence',
      content: '混合办公的关键在管理方式还是办公地点：陆行舟强调管理，韩雪强调协调成本。',
      sourceMessageIds: [
        'seed-remote-work-ongoing-round-2-msg-2',
        'seed-remote-work-ongoing-round-2-msg-1',
      ],
    },
  ],
};

async function seedLite(): Promise<void> {
  await prisma.discussion.create({
    data: {
      id: 'seed-housing-waiting',
      topic: '年轻人该不该买房？',
      status: 'waiting',
      expertCount: 4,
      createdAt: new Date('2026-11-20T09:00:00.000Z'),
    },
  });

  await prisma.discussion.create({
    data: {
      id: 'seed-ev-generating',
      topic: '新能源汽车的下一个五年',
      status: 'generating',
      expertCount: 4,
      createdAt: new Date('2026-11-20T08:00:00.000Z'),
    },
  });

  await prisma.discussion.create({
    data: {
      id: 'seed-ai-education-finished',
      topic: '高校该不该全面推行 AI 教学？',
      status: 'finished',
      expertCount: 4,
      summary:
        '讨论认为 AI 教学应作为基础工具全面引入，但必须保留人文与批判性思维课程，避免把教育简化为工具训练。',
      createdAt: new Date('2026-11-17T09:00:00.000Z'),
      finishedAt: new Date('2026-11-17T09:30:00.000Z'),
    },
  });
}

async function main(): Promise<void> {
  await prisma.discussion.deleteMany({ where: { id: { in: SEED_IDS } } });

  await seedFull(AI_JOBS);
  await seedFull(REMOTE_WORK);
  await seedLite();

  const discussions = await prisma.discussion.count({ where: { id: { in: SEED_IDS } } });
  const messages = await prisma.message.count({
    where: { discussion: { id: { in: SEED_IDS } } },
  });
  const consensus = await prisma.consensusItem.count({
    where: { discussion: { id: { in: SEED_IDS } } },
  });
  const sources = await prisma.consensusItemMessage.count({
    where: { consensusItem: { discussion: { id: { in: SEED_IDS } } } },
  });

  console.log(
    `✅ seed 完成：${discussions} 场讨论 / ${messages} 条消息 / ${consensus} 条共识分歧 / ${sources} 条溯源`,
  );
}

main()
  .catch((e) => {
    console.error('❌ seed 失败：', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
