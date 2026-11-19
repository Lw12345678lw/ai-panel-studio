// llm.ts — LLM 通用封装：请求、超时、重试、三层 JSON 解析
// 只关心「把消息发给模型并拿到解析后的 JSON 内容」，不关心具体业务语义。
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1';
const API_KEY = process.env.LLM_API_KEY ?? '';
const MODEL = process.env.LLM_MODEL ?? 'deepseek-chat';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 1;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  maxRetries?: number;
  timeoutMs?: number;
  temperature?: number;
}

// 三层解析：直接 parse → 剥 ```json 代码块 → 截取首个 [ ] / { }
function extractJson(content: string): unknown {
  const text = content.trim();

  try {
    return JSON.parse(text);
  } catch {
    /* 继续 */
  }

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* 继续 */
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
        /* 继续 */
      }
    }
  }

  throw new Error('无法从模型输出中提取 JSON');
}

function isTimeoutError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
}

async function requestOnce(
  messages: ChatMessage[],
  timeoutMs: number,
  temperature: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({ model: MODEL, messages, temperature, stream: false }),
      signal: controller.signal,
    });

    const raw = await res.text();

    if (!res.ok) {
      throw new Error(`LLM API 返回 HTTP ${res.status}: ${raw.slice(0, 200)}`);
    }

    let envelope: { choices?: { message?: { content?: unknown } }[] };
    try {
      envelope = JSON.parse(raw) as { choices?: { message?: { content?: unknown } }[] };
    } catch {
      throw new Error('LLM 响应体不是合法 JSON');
    }

    const content = envelope.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('LLM 响应缺少有效的 content');
    }

    return extractJson(content);
  } finally {
    clearTimeout(timer);
  }
}

export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
): Promise<unknown> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const temperature = options.temperature ?? 0.7;

  let lastError: Error = new Error('LLM 调用失败（未知原因）');
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await requestOnce(messages, timeoutMs, temperature);
    } catch (e) {
      if (isTimeoutError(e)) {
        // 超时不重试，直接抛明确错误
        throw new Error(`LLM 请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
      }
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  throw lastError;
}
