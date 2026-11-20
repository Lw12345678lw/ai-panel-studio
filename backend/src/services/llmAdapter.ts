// llmAdapter.ts — 把 llm.ts 的通用封装适配成 orchestrator 需要的 LlmClient。
// 负责 JSON 结构校验；重试由 orchestrator 的 withRetry 统一负责。
import {
  chatCompletion,
  streamSpeech,
  type ChatCompletionOptions,
  type ChatMessage,
} from './llm';
import type { LlmClient } from './orchestrator';

export interface StreamSpeechOptions {
  timeoutMs?: number;
  temperature?: number;
}

export interface LlmAdapterDeps {
  chatCompletion: (messages: ChatMessage[], options?: ChatCompletionOptions) => Promise<unknown>;
  streamSpeech: (
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    options?: StreamSpeechOptions,
  ) => Promise<string>;
}

export function createLlmAdapter(deps: LlmAdapterDeps): LlmClient {
  return {
    streamSpeech(messages, onChunk) {
      return deps.streamSpeech(messages, onChunk);
    },

    async selectSpeakers(messages, _speechCounts) {
      // speechCounts 已由 orchestrator 写进 prompt，这里只做结构校验
      const raw = await deps.chatCompletion(messages, { temperature: 0.3 });
      const speakers = (raw as { speakers?: unknown } | null)?.speakers;
      if (!Array.isArray(speakers) || speakers.some((s) => typeof s !== 'string')) {
        throw new Error('选人结果格式非法：期望 { "speakers": string[] }');
      }
      return { speakers };
    },

    async extractConsensus(messages) {
      const raw = await deps.chatCompletion(messages, { temperature: 0.3 });
      const items = (raw as { items?: unknown } | null)?.items;
      if (!Array.isArray(items)) {
        throw new Error('共识提炼结果格式非法：期望 { "items": [...] }');
      }

      // 丢弃结构非法的条目，而不是让整轮提炼失败
      const valid = items.flatMap((item) => {
        const it = item as { type?: unknown; content?: unknown; sources?: unknown } | null;
        if (it?.type !== 'consensus' && it?.type !== 'divergence') return [];
        if (typeof it.content !== 'string' || !it.content.trim()) return [];
        const content = it.content.trim();

        // sources 缺省时不补字段；显式给了非法值（非数组）则回退为空数组
        if (it.sources === undefined) return [{ type: it.type, content }];
        const sources = Array.isArray(it.sources)
          ? it.sources.filter((s): s is string => typeof s === 'string')
          : [];
        return [{ type: it.type, content, sources }];
      });

      return { items: valid };
    },
  };
}

// 生产环境实例：底层直接使用 llm.ts 的真实实现
export const llmAdapter = createLlmAdapter({ chatCompletion, streamSpeech });
