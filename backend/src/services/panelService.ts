// panelService.ts — 嘉宾生成服务：prompt 构建 + 结果校验
import { chatCompletion, type ChatMessage } from './llm';

export class PanelGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PanelGenerationError';
  }
}

export interface GeneratedPanelMember {
  name: string;
  title: string;
  position: string;
  stance: string;
  color: string;
  role: 'host' | 'expert';
}

// 备用调色板：修复重复颜色时分配未用色
const FALLBACK_COLORS = [
  '#0EA5E9', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981',
  '#EF4444', '#3B82F6', '#F97316', '#14B8A6', '#6366F1',
  '#A855F7', '#EAB308', '#06B6D4', '#84CC16', '#D946EF', '#64748B',
];

function buildSystemPrompt(expertCount: number): string {
  return [
    '你是「AI 圆桌讨论」的嘉宾阵容生成器。你的唯一任务是输出一个 JSON 数组，不要输出任何解释、前言、注释或 Markdown 代码块（不要用 ``` 包裹）。',
    '',
    `请为指定话题生成一场圆桌讨论的嘉宾阵容，共 ${expertCount + 1} 人：`,
    '- 1 位主持人（role = "host"），负责开场、追问、串联与收尾。',
    `- ${expertCount} 位专家（role = "expert"），立场互相有差异、能形成观点碰撞。`,
    '',
    'JSON 数组的每个元素是一个对象，必须且仅包含以下 6 个字段：',
    '1. "name"：中文姓名（字符串）',
    '2. "title"：头衔，如「资深经济学家」「AI 研究员」（字符串）',
    '3. "position"：职位/机构（字符串）',
    '4. "stance"：一句话立场（字符串，见下方「立场多样性硬要求」）',
    '5. "color"：专属颜色，十六进制 #RRGGBB 格式，所有人颜色互不相同（字符串）',
    '6. "role"："host" 或 "expert"（字符串）',
    '',
    '立场多样性硬要求：',
    '- 专家 stance 必须覆盖该话题的主要争议维度（如支持/反对/折中/次生影响），任意两位专家的立场不得意思相近。',
    '- stance 是一句有明确倾向的观点判断，禁止「需要综合考虑」「有利有弊」这类中立套话。',
    '- 主持人的 stance 保持中立，只描述控场职责，不表达观点倾向。',
    '',
    '要求：',
    '- 只输出 JSON 数组本身，第一个元素是主持人，其余是专家。',
    '- 颜色必须符合 #RRGGBB 正则（如 #3B82F6），且彼此不重复。',
    '- 颜色必须选择明亮、高饱和度的颜色（如 #3B82F6、#10B981），禁止使用过深（如 #0F172A、#111111）或过浅（如 #FFFFFF、#F5F5F5）的颜色。',
    '- 所有嘉宾的姓名必须互不相同，专家之间不能重名。',
    '- 不要输出 JSON 之外的任何文字。',
  ].join('\n');
}

function buildMessages(topic: string, expertCount: number): ChatMessage[] {
  return [
    { role: 'system', content: buildSystemPrompt(expertCount) },
    { role: 'user', content: `请为话题「${topic}」生成嘉宾阵容（1 位主持人 + ${expertCount} 位专家）。` },
  ];
}

function validateAndNormalize(input: unknown, expertCount: number): GeneratedPanelMember[] {
  // 归一化为数组（兼容模型偶尔输出 { panel: [...] } 包装）
  let arr: unknown[];
  if (Array.isArray(input)) {
    arr = input;
  } else if (input && typeof input === 'object' && Array.isArray((input as { panel?: unknown }).panel)) {
    arr = (input as { panel: unknown[] }).panel;
  } else {
    throw new PanelGenerationError('模型输出不是 JSON 数组');
  }

  const members: GeneratedPanelMember[] = arr.map((raw, i) => {
    if (!raw || typeof raw !== 'object') {
      throw new PanelGenerationError(`第 ${i} 个成员不是对象`);
    }
    const rec = raw as Record<string, unknown>;

    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    const title = typeof rec.title === 'string' ? rec.title.trim() : '';
    const position = typeof rec.position === 'string' ? rec.position.trim() : '';
    const stance = typeof rec.stance === 'string' ? rec.stance.trim() : '';
    const color = typeof rec.color === 'string' ? rec.color.trim() : '';
    const role = rec.role;

    if (!name) throw new PanelGenerationError(`第 ${i} 个成员 name 缺失或为空白`);
    if (!title) throw new PanelGenerationError(`第 ${i} 个成员 title 缺失或为空白`);
    if (!position) throw new PanelGenerationError(`第 ${i} 个成员 position 缺失或为空白`);
    if (!stance) throw new PanelGenerationError(`第 ${i} 个成员 stance 缺失或为空白`);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new PanelGenerationError(`第 ${i} 个成员 color 非法: "${color}"`);
    }
    if (role !== 'host' && role !== 'expert') {
      throw new PanelGenerationError(`第 ${i} 个成员 role 非法: ${String(role)}`);
    }

    return { name, title, position, stance, color, role: role as 'host' | 'expert' };
  });

  const hosts = members.filter((m) => m.role === 'host');
  if (hosts.length !== 1) {
    throw new PanelGenerationError(`主持人数量应为 1，实际 ${hosts.length}`);
  }

  const experts = members.filter((m) => m.role === 'expert');
  if (experts.length !== expertCount) {
    throw new PanelGenerationError(`专家数量应为 ${expertCount}，实际 ${experts.length}`);
  }

  // 名字是选人阶段的兜底解析键，专家重名会导致「名字 → ID」映射歧义
  const expertNames = experts.map((m) => m.name);
  if (new Set(expertNames).size !== expertNames.length) {
    throw new PanelGenerationError('专家名字重复，无法唯一识别发言人');
  }

  return fixDuplicateColors(members);
}

function fixDuplicateColors(members: GeneratedPanelMember[]): GeneratedPanelMember[] {
  const seen = new Set<string>();
  return members.map((m) => {
    let color = m.color;
    if (seen.has(color.toLowerCase())) {
      const unused = FALLBACK_COLORS.find((c) => !seen.has(c.toLowerCase()));
      if (!unused) {
        throw new PanelGenerationError('备用调色板耗尽，无法修复重复颜色');
      }
      color = unused;
    }
    seen.add(color.toLowerCase());
    return { ...m, color };
  });
}

const CONTENT_MAX_ATTEMPTS = 2; // 初始 1 次 + 内容性错误重试 1 次

export async function generatePanel(
  topic: string,
  expertCount: number,
): Promise<GeneratedPanelMember[]> {
  let lastError: PanelGenerationError = new PanelGenerationError('嘉宾生成失败');

  for (let attempt = 0; attempt < CONTENT_MAX_ATTEMPTS; attempt++) {
    let parsed: unknown;
    try {
      parsed = await chatCompletion(buildMessages(topic, expertCount));
    } catch (e) {
      // 网络 / 超时 / JSON 解析错误由 chatCompletion 内部处理，这里不再做内容级重试
      const msg = e instanceof Error ? e.message : String(e);
      throw new PanelGenerationError(`嘉宾生成失败：${msg}`);
    }

    try {
      return validateAndNormalize(parsed, expertCount);
    } catch (e) {
      if (!(e instanceof PanelGenerationError)) throw e;
      lastError = e; // 内容性错误（含专家重名）→ 重试
    }
  }

  throw lastError;
}
