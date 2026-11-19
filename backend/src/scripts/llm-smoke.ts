/**
 * llm-smoke.ts — LLM 连通性 smoke test / 联调排查工具
 *
 * 用途：
 *   验证 DeepSeek（OpenAI 兼容）API 连通性，以及「嘉宾阵容生成」的 JSON 输出稳定性。
 *   连续跑 N 次不同话题，统计解析成功率 / 耗时 / token 用量，用于联调时排查 LLM 侧问题。
 *
 * 运行方式（在 backend 目录下）：
 *   npx ts-node --transpile-only src/scripts/llm-smoke.ts
 *
 * 说明：
 *   - 独立工具脚本，不被 src 主代码路径（index.ts / 业务模块）import。
 *   - 依赖 backend/.env 中的 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL。
 */
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1';
const API_KEY = process.env.LLM_API_KEY ?? '';
const MODEL = process.env.LLM_MODEL ?? 'deepseek-chat';
const PLACEHOLDER_KEY = 'your_deepseek_api_key_here';

interface PanelMember {
  name: string;
  title: string;
  position: string;
  stance: string;
  color: string;
  role: string; // host | expert
}

interface RunResult {
  topic: string;
  httpStatus: number;
  elapsedMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  parseSuccess: boolean;
  fieldsComplete: boolean;
  hostCount: number;
  expertCount: number;
  error?: string;
  rawContent?: string;
}

const SYSTEM_PROMPT = [
  '你是 JSON 生成器，只输出一个合法 JSON 数组，不输出任何解释、注释、前言或 Markdown 代码块。',
  '',
  '任务：为一个圆桌讨论生成嘉宾阵容，共 5 人 = 1 位主持人 + 4 位专家。',
  '',
  '输出 JSON 数组，每个元素必须包含且仅包含这些字段：',
  '- name: 中文姓名',
  '- title: 头衔（如「资深经济学家」「AI 研究员」）',
  '- position: 职位/机构',
  '- stance: 立场（一句话，5 人立场要有差异、形成观点碰撞）',
  '- color: 十六进制颜色 #RRGGBB，5 人互不相同',
  '- role: "host"（主持人）或 "expert"（专家）',
  '',
  '严格输出 JSON 数组本身，不要用 ``` 包裹，不要加任何前后缀文字。',
].join('\n');

// 从模型输出中稳健地提取 JSON（兼容直接输出 / 代码块包裹 / 前后缀废话）
function extractJson(content: string): unknown {
  const text = content.trim();

  try {
    return JSON.parse(text);
  } catch {
    /* 继续尝试 */
  }

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* 继续尝试 */
    }
  }

  for (const [open, close] of [
    ['[', ']'],
    ['{', '}'],
  ] as const) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        /* 继续尝试 */
      }
    }
  }

  throw new Error('无法从模型输出中提取 JSON');
}

function validate(input: unknown): PanelMember[] {
  let panel: any[];
  if (Array.isArray(input)) {
    panel = input;
  } else {
    const wrapped = input as { panel?: unknown } | null | undefined;
    if (wrapped && Array.isArray(wrapped.panel)) {
      panel = wrapped.panel;
    } else {
      throw new Error(`期望 JSON 数组，实际得到 ${typeof input}`);
    }
  }

  const required = ['name', 'title', 'position', 'stance', 'color', 'role'] as const;
  panel.forEach((m, i) => {
    if (!m || typeof m !== 'object') {
      throw new Error(`第 ${i} 个成员不是对象`);
    }
    for (const f of required) {
      const v = (m as Record<string, unknown>)[f];
      if (typeof v !== 'string' || !v.trim()) {
        throw new Error(`第 ${i} 个成员缺少字段 "${f}"`);
      }
    }
    const color = (m as PanelMember).color;
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw new Error(`第 ${i} 个成员 color 非法: ${color}`);
    }
  });

  const members = panel as PanelMember[];
  const hosts = members.filter((m) => m.role === 'host');
  const experts = members.filter((m) => m.role === 'expert');
  if (hosts.length !== 1) throw new Error(`主持人数量应为 1，实际 ${hosts.length}`);
  if (experts.length !== 4) throw new Error(`专家数量应为 4，实际 ${experts.length}`);

  const colors = new Set(members.map((m) => m.color.toLowerCase()));
  if (colors.size !== members.length) throw new Error('存在重复颜色');

  return members;
}

async function runOnce(topic: string): Promise<RunResult> {
  const t0 = performance.now();

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `讨论话题：${topic}` },
        ],
        temperature: 0.7,
        stream: false,
      }),
    });
  } catch (e) {
    return {
      topic,
      httpStatus: 0,
      elapsedMs: performance.now() - t0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      parseSuccess: false,
      fieldsComplete: false,
      hostCount: 0,
      expertCount: 0,
      error: `网络错误: ${(e as Error).message}`,
    };
  }

  // 关键：先读完整个响应体，再计时，得到真实完整耗时
  const raw = await res.text();
  const elapsedMs = performance.now() - t0;

  if (!res.ok) {
    return {
      topic,
      httpStatus: res.status,
      elapsedMs,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      parseSuccess: false,
      fieldsComplete: false,
      hostCount: 0,
      expertCount: 0,
      error: `HTTP ${res.status}`,
      rawContent: raw,
    };
  }

  let data: {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  try {
    data = JSON.parse(raw);
  } catch {
    return {
      topic,
      httpStatus: res.status,
      elapsedMs,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      parseSuccess: false,
      fieldsComplete: false,
      hostCount: 0,
      expertCount: 0,
      error: '响应体不是合法 JSON',
      rawContent: raw,
    };
  }

  const content = data.choices?.[0]?.message?.content ?? '';
  const usage = data.usage ?? {};

  try {
    const panel = validate(extractJson(content));
    return {
      topic,
      httpStatus: res.status,
      elapsedMs,
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0,
      parseSuccess: true,
      fieldsComplete: true,
      hostCount: panel.filter((m) => m.role === 'host').length,
      expertCount: panel.filter((m) => m.role === 'expert').length,
    };
  } catch (e) {
    return {
      topic,
      httpStatus: res.status,
      elapsedMs,
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0,
      parseSuccess: false,
      fieldsComplete: false,
      hostCount: 0,
      expertCount: 0,
      error: (e as Error).message,
      rawContent: content,
    };
  }
}

async function main() {
  if (!API_KEY || API_KEY === PLACEHOLDER_KEY) {
    console.error('✗ LLM_API_KEY 未配置（仍是占位符），请编辑 backend/.env 填入真实 key。');
    process.exit(1);
  }

  const topics = [
    '人工智能对就业市场的长期影响',
    '远程办公是否会成为未来主流工作模式',
    '新能源汽车的下一个五年会怎样',
    '年轻人该不该尽早买房',
    '开源大模型是否会取代闭源商业模型',
  ];

  console.log(`连续运行 ${topics.length} 次（不同话题），模型 ${MODEL}\n`);

  const results: RunResult[] = [];
  for (let i = 0; i < topics.length; i++) {
    console.log(`--- 第 ${i + 1}/${topics.length} 次：${topics[i]} ---`);
    const r = await runOnce(topics[i]);
    results.push(r);

    console.log(
      `HTTP ${r.httpStatus} | 耗时 ${r.elapsedMs.toFixed(0)}ms | tokens prompt=${r.promptTokens} completion=${r.completionTokens}`,
    );
    console.log(
      `解析: ${r.parseSuccess ? '✓ 成功' : '✗ 失败'} | 字段: ${r.fieldsComplete ? '✓ 齐全' : '✗ 缺失'} | 主持人=${r.hostCount} 专家=${r.expertCount}`,
    );

    if (!r.parseSuccess && r.rawContent !== undefined) {
      console.log(`\n[失败原始输出]\n${r.rawContent}\n`);
    }
    console.log('');
  }

  const successCount = results.filter((r) => r.parseSuccess).length;
  const times = results.map((r) => r.elapsedMs);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const slowest = Math.max(...times);
  const fastest = Math.min(...times);
  const totalTokens = results.reduce((a, r) => a + r.totalTokens, 0);

  console.log('================ 汇总 ================');
  results.forEach((r, i) => {
    console.log(
      `第${i + 1}次  HTTP ${r.httpStatus}  耗时 ${r.elapsedMs.toFixed(0)}ms  解析${r.parseSuccess ? '✓' : '✗'}  字段${r.fieldsComplete ? '✓' : '✗'}  host/expert=${r.hostCount}/${r.expertCount}  completion=${r.completionTokens}`,
    );
  });
  console.log('');
  console.log(`解析成功率: ${successCount}/${topics.length} (${((successCount / topics.length) * 100).toFixed(0)}%)`);
  console.log(`平均耗时: ${avg.toFixed(0)}ms  最快: ${fastest.toFixed(0)}ms  最慢: ${slowest.toFixed(0)}ms`);
  console.log(`总 tokens（${topics.length} 次合计）: ${totalTokens}`);
}

main().catch((e) => {
  console.error('✗ 未捕获错误:', e);
  process.exit(1);
});
