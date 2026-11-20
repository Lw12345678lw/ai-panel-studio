// orchestrator.ts — 讨论编排器：固定状态机 + LLM 内容生成
// 依赖注入：llm / db / emit 全部由外部传入，本模块不直接 fetch 或 new PrismaClient。
import type { ChatMessage } from './llm';

export interface Member {
  id: string;
  role: 'host' | 'expert';
  name?: string;
  title?: string;
  position?: string;
  stance?: string;
  color?: string;
}

export type RuntimeStatus = 'idle' | 'preparing' | 'speaking';

export interface SseEvent {
  type: string;
  data: unknown;
}

export interface LlmClient {
  streamSpeech(messages: ChatMessage[], onChunk: (chunk: string) => void): Promise<string>;
  selectSpeakers(
    messages: ChatMessage[],
    speechCounts: Record<string, number>,
  ): Promise<{ speakers: string[] }>;
  extractConsensus(messages: ChatMessage[]): Promise<{ items: { type: string; content: string; sources?: string[] }[] }>;
}

export interface DiscussionDb {
  getDiscussion(id: string): Promise<{
    id: string;
    topic: string;
    expertCount: number;
    status?: string;
    summary?: string | null;
    finishedAt?: Date | null;
  } | null>;
  getMembers(discussionId: string): Promise<Member[]>;
  createRound(data: { discussionId: string; seq: number; question: string }): Promise<{ id: string }>;
  closeRound(roundId: string): Promise<void>;
  createMessage(data: {
    discussionId: string;
    panelMemberId: string;
    roundId: string | null;
    content: string;
    type: string;
  }): Promise<{ id: string }>;
  createConsensusItem(data: { discussionId: string; type: string; content: string }): Promise<{ id: string }>;
  createConsensusSource(data: { consensusItemId: string; messageId: string }): Promise<void>;
  finishDiscussion(id: string, summary: string): Promise<void>;
}

export interface OrchestratorDeps {
  llm: LlmClient;
  db: DiscussionDb;
  emit: (event: SseEvent) => void;
}

// ===== 4 个系统 Prompt =====
const HOST_SYSTEM = [
  '你是「AI 圆桌讨论」的主持人，负责开场、抛子问题、追问、串联与收尾总结。',
  '',
  '规则：',
  '- 发言口语化、自然、简洁，每次 1~2 句话。',
  '- 开场要点题并说明讨论目标；抛子问题要具体、有争议性、便于展开。',
  '- 总结用自然语言收束全场观点与结论，不要输出 JSON。',
  '- 不表达你自己的观点倾向，保持中立控场。',
].join('\n');

function expertSystem(member: Member): string {
  const name = member.name ?? member.id;
  const title = member.title ?? '专家';
  const position = member.position ?? '';
  const stance = member.stance ?? '保持专业中立';
  return [
    `你是「AI 圆桌讨论」的专家：${name}（${title}，${position}）。你的立场是：${stance}。`,
    '',
    '规则：',
    '- 你必须回应 transcript 中某位或某几位专家的具体观点——明确表示同意、反对或补充，点名对方（如「我不同意张薇的看法……」「陈志强提到的这点我再补充……」）。禁止不回应他人、只自说自话。',
    '- 在回应之后，再结合自己的立场给出观点，每次发言 1~2 句话，观点明确、有倾向性，禁止「需要综合考虑」「有利有弊」这类中立套话。',
    '- 只输出发言内容本身，不要加任何前缀、解释或格式标记。',
  ].join('\n');
}

const SELECT_SYSTEM = [
  '你是「AI 圆桌讨论」的调度者。根据当前子问题和现场 transcript，选出接下来最应该发言的 2~3 位专家。',
  '',
  '规则：',
  '- 同一轮内不要重复选同一专家。',
  '- 优先选发言次数少、立场能碰撞的专家（各专家已发言次数见下方）。',
  '- 只输出 JSON：{"speakers":["专家ID", ...]}，不要输出其他文字。',
].join('\n');

const CONSENSUS_SYSTEM = [
  '你是「AI 圆桌讨论」的纪要员。根据最近一轮的 transcript，提炼共识与分歧。',
  '',
  '规则：',
  '- 共识（consensus）：多位专家观点一致或趋同的点。',
  '- 分歧（divergence）：专家之间明显对立或矛盾的点。',
  '- 每条一句话、观点明确。若没有共识或分歧，返回空数组。',
  '- 每条必须引用本轮至少 1 位专家的发言摘要（自然语言，不要求 messageId），让共识/分歧可追溯到具体谁说了什么。',
  '',
  '只输出 JSON：',
  '{"items":[{"type":"consensus"|"divergence","content":"...","sources":["专家原话的摘要", ...]}]}',
].join('\n');

// ===== 工具 =====
function isTimeoutError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isTimeoutError(e)) throw e; // 超时不重试
    return await fn(); // 普通错误重试一次
  }
}

function applyGuardrails(
  selected: string[],
  experts: Member[],
  roundSeq: number,
  totalRounds: number,
  speechCounts: Record<string, number>,
): string[] {
  // 同轮去重：同一专家本轮最多被选中 1 次
  const deduped = [...new Set(selected)].filter((id) => experts.some((e) => e.id === id));
  // 发言公平：进入后半程后，强制安排尚未发言的专家（防沉默）
  if (roundSeq > totalRounds / 2) {
    const silent = experts.filter(
      (e) => (speechCounts[e.id] ?? 0) === 0 && !deduped.includes(e.id),
    );
    if (silent.length > 0) deduped.push(silent[0].id);
  }
  return deduped;
}

// 反向匹配：把模型输出的 sources（自然语言摘要，非 messageId）匹配回本轮具体 Message，
// 得到对应的 messageId 用于 ConsensusItemMessage 溯源 join。
function matchSourcesToMessages(
  sources: string[],
  roundMessages: { id: string; panelMemberId: string; content: string }[],
  members: Member[],
): string[] {
  const nameById = new Map(members.map((m) => [m.id, m.name ?? m.id]));
  const matched = new Set<string>();
  for (const source of sources) {
    for (const msg of roundMessages) {
      const name = nameById.get(msg.panelMemberId) ?? msg.panelMemberId;
      // 匹配规则：来源摘要里出现发言人名字，或与 Message 内容有包含关系
      const nameHit = source.includes(name);
      const contentHit = msg.content.length > 0 && source.includes(msg.content);
      if (nameHit || contentHit) matched.add(msg.id);
    }
  }
  // 兜底：未匹配到任何消息时退回本轮全部消息，保证溯源不丢
  if (matched.size === 0) return roundMessages.map((m) => m.id);
  return [...matched];
}

// ===== prompt 构建（返回 user message 内容字符串）=====
function buildTranscript(transcript: string[]): string {
  return transcript.length > 0 ? transcript.join('\n') : '（尚无发言）';
}

function buildHostSubQuestion(topic: string, seq: number, total: number, transcript: string[]): string {
  return [
    `讨论话题：${topic}`,
    `这是第 ${seq} 轮（共 ${total} 轮）。请抛出一个具体、有争议性的子问题，引导专家展开讨论。`,
    '',
    '现场 transcript：',
    buildTranscript(transcript),
  ].join('\n');
}

function buildHostSummary(topic: string, transcript: string[]): string {
  return [
    `讨论话题：${topic}`,
    '请做收尾总结，用自然语言概括各方观点与最终结论，不要输出 JSON。',
    '',
    '现场 transcript：',
    buildTranscript(transcript),
  ].join('\n');
}

function buildExpertSpeech(topic: string, subQuestion: string, transcript: string[]): string {
  return [
    `讨论话题：${topic}`,
    `当前子问题：${subQuestion}`,
    '请就该子问题发表你的看法（1~2 句话，立场明确）。',
    '',
    '现场 transcript（其他专家已发言）：',
    buildTranscript(transcript),
  ].join('\n');
}

function buildSelection(topic: string, subQuestion: string, experts: Member[], transcript: string[]): string {
  const expertList = experts
    .map((e) => `- [${e.id}] ${e.name ?? e.id}（立场：${e.stance ?? '—'}）`)
    .join('\n');
  return [
    `讨论话题：${topic}`,
    `当前子问题：${subQuestion}`,
    '',
    '候选专家：',
    expertList,
    '',
    '现场 transcript：',
    buildTranscript(transcript),
  ].join('\n');
}

function buildConsensus(topic: string, subQuestion: string, transcript: string[]): string {
  return [
    `讨论话题：${topic}`,
    `当前子问题：${subQuestion}`,
    '请从以上 transcript 提炼共识与分歧。',
    '',
    '现场 transcript：',
    buildTranscript(transcript),
  ].join('\n');
}

// ===== 主流程 =====
export async function runDiscussion(discussionId: string, deps: OrchestratorDeps): Promise<void> {
  const { llm, db, emit } = deps;

  const discussion = await db.getDiscussion(discussionId);
  if (!discussion) throw new Error('讨论不存在');
  const members = await db.getMembers(discussionId);
  const host = members.find((m) => m.role === 'host');
  const experts = members.filter((m) => m.role === 'expert');
  if (!host || experts.length === 0) throw new Error('讨论缺少主持人或专家');

  // 每个 discussion 一个编排器实例：运行时状态 Map<memberId, RuntimeStatus>
  const runtime = new Map<string, RuntimeStatus>(members.map((m) => [m.id, 'idle']));
  const speechCounts: Record<string, number> = {};
  for (const e of experts) speechCounts[e.id] = 0;
  const transcript: string[] = [];
  const totalRounds = experts.length;

  const setStatus = (memberId: string, status: RuntimeStatus) => {
    runtime.set(memberId, status);
    emit({ type: 'status_update', data: { panelMemberId: memberId, status } });
  };

  const speak = async (
    member: Member,
    messages: ChatMessage[],
    type: string,
    roundId: string | null,
  ): Promise<{ id: string; content: string }> => {
    setStatus(member.id, 'preparing');
    setStatus(member.id, 'speaking');
    emit({ type: 'speech_start', data: { panelMemberId: member.id, panelMember: member } });

    const full = await withRetry(() =>
      llm.streamSpeech(messages, (chunk) => {
        emit({ type: 'speech_chunk', data: { panelMemberId: member.id, content: chunk } });
      }),
    );

    const message = await db.createMessage({
      discussionId,
      panelMemberId: member.id,
      roundId,
      content: full,
      type,
    });
    transcript.push(`${member.name ?? member.id}：${full}`);
    setStatus(member.id, 'idle');
    emit({ type: 'speech_end', data: { panelMemberId: member.id, message } });
    return { id: message.id, content: full };
  };

  // 收尾事件必须带真实落库状态（status=finished / summary / finishedAt），
  // 不能复用开场时的 discussion 快照。
  const emitFinished = async () => {
    let payload = discussion;
    try {
      payload = (await db.getDiscussion(discussionId)) ?? discussion;
    } catch {
      /* 读取失败则退回原快照 */
    }
    emit({ type: 'discussion_finished', data: { discussion: payload } });
  };

  emit({ type: 'discussion_started', data: { discussion } });

  try {
    // 1. 主持人开场
    await speak(
      host,
      [
        { role: 'system', content: HOST_SYSTEM },
        { role: 'user', content: `讨论话题：${discussion.topic}\n请做开场，点题并说明讨论目标。` },
      ],
      'speech',
      null,
    );

    // 2. 逐轮
    for (let seq = 1; seq <= totalRounds; seq++) {
      const subQ = await speak(
        host,
        [
          { role: 'system', content: HOST_SYSTEM },
          { role: 'user', content: buildHostSubQuestion(discussion.topic, seq, totalRounds, transcript) },
        ],
        'speech',
        null,
      );
      const subQuestion = subQ.content;
      const roundStartIndex = transcript.length - 1; // 本轮 transcript 起点（子问题）

      const round = await db.createRound({ discussionId, seq, question: subQuestion });

      const selection = await withRetry(() =>
        llm.selectSpeakers(
          [
            { role: 'system', content: SELECT_SYSTEM },
            { role: 'user', content: buildSelection(discussion.topic, subQuestion, experts, transcript) },
          ],
          { ...speechCounts },
        ),
      );
      const speakers = applyGuardrails(selection.speakers, experts, seq, totalRounds, speechCounts);

      const roundMessages: { id: string; panelMemberId: string; content: string }[] = [];
      for (const speakerId of speakers) {
        const expert = experts.find((e) => e.id === speakerId);
        if (!expert) continue;
        // 注意：传入的 messages 必须包含全量 transcript（专家要能看到其他专家的发言才能交锋）。
        const msg = await speak(
          expert,
          [
            { role: 'system', content: expertSystem(expert) },
            { role: 'user', content: buildExpertSpeech(discussion.topic, subQuestion, transcript) },
          ],
          'speech',
          round.id,
        );
        roundMessages.push({ id: msg.id, panelMemberId: expert.id, content: msg.content });
        speechCounts[expert.id] = (speechCounts[expert.id] ?? 0) + 1;
      }

      await db.closeRound(round.id);

      const consensus = await withRetry(() =>
        llm.extractConsensus([
          { role: 'system', content: CONSENSUS_SYSTEM },
          { role: 'user', content: buildConsensus(discussion.topic, subQuestion, transcript.slice(roundStartIndex)) },
        ]),
      );
      const items: unknown[] = [];
      for (const item of consensus.items) {
        const created = await db.createConsensusItem({
          discussionId,
          type: item.type,
          content: item.content,
        });
        const sourceMessageIds = matchSourcesToMessages(item.sources ?? [], roundMessages, members);
        for (const mid of sourceMessageIds) {
          await db.createConsensusSource({ consensusItemId: created.id, messageId: mid });
        }
        items.push({ id: created.id, ...item, sourceMessageIds });
      }
      emit({ type: 'consensus_update', data: { items } });
    }

    // 3. 主持人总结
    const summary = await speak(
      host,
      [
        { role: 'system', content: HOST_SYSTEM },
        { role: 'user', content: buildHostSummary(discussion.topic, transcript) },
      ],
      'summary',
      null,
    );

    await db.finishDiscussion(discussionId, summary.content);
    emit({ type: 'discussion_summary', data: { summary: summary.content } });
    await emitFinished();
  } catch (e) {
    emit({ type: 'error', data: { message: e instanceof Error ? e.message : String(e) } });
    await db.finishDiscussion(discussionId, '讨论因错误提前结束');
    await emitFinished();
  }
}
