// llmAdapter.test.ts — TDD：LlmClient 适配层的契约测试（实现尚未存在，预期全红）
// 底层 chatCompletion / streamSpeech 全部注入 mock，绝不真实调用 DeepSeek。
import { describe, it, expect, vi } from 'vitest';
import { createLlmAdapter } from '../src/services/llmAdapter';

const msgs = [{ role: 'user' as const, content: 'hi' }];

function makeDeps() {
  return {
    chatCompletion: vi.fn(),
    streamSpeech: vi.fn(),
  };
}

describe('llmAdapter.selectSpeakers', () => {
  it('合法 { speakers: string[] } 原样返回', async () => {
    const deps = makeDeps();
    deps.chatCompletion.mockResolvedValue({ speakers: ['e1', 'e2'] });
    const llm = createLlmAdapter(deps);

    await expect(llm.selectSpeakers(msgs, { e1: 0, e2: 0 })).resolves.toEqual({
      speakers: ['e1', 'e2'],
    });
    expect(deps.chatCompletion).toHaveBeenCalledWith(
      msgs,
      expect.objectContaining({ temperature: 0.3 }),
    );
  });

  it('shape 非法（speakers 不是字符串数组）抛错', async () => {
    const deps = makeDeps();
    const llm = createLlmAdapter(deps);

    for (const bad of [{ speakers: [1, 2] }, { speakers: 'e1' }, { speakers: null }, {}, null]) {
      deps.chatCompletion.mockResolvedValueOnce(bad);
      await expect(llm.selectSpeakers(msgs, {})).rejects.toThrow();
    }
  });

  it('未知专家 id 不在此过滤（交给编排器护栏）', async () => {
    const deps = makeDeps();
    deps.chatCompletion.mockResolvedValue({ speakers: ['ghost', 'e1'] });
    const llm = createLlmAdapter(deps);

    await expect(llm.selectSpeakers(msgs, {})).resolves.toEqual({
      speakers: ['ghost', 'e1'],
    });
  });
});

describe('llmAdapter.extractConsensus', () => {
  it('保留合法项，丢弃非法 type / 空 content 的项', async () => {
    const deps = makeDeps();
    deps.chatCompletion.mockResolvedValue({
      items: [
        { type: 'consensus', content: 'A', sources: ['张薇：AI 会替代部分岗位'] },
        { type: 'weird', content: 'B' },
        { type: 'divergence', content: '   ' },
        { type: 'divergence', content: 'C' },
      ],
    });
    const llm = createLlmAdapter(deps);

    await expect(llm.extractConsensus(msgs)).resolves.toEqual({
      items: [
        { type: 'consensus', content: 'A', sources: ['张薇：AI 会替代部分岗位'] },
        { type: 'divergence', content: 'C' },
      ],
    });
  });

  it('items 不是数组时抛错（交给编排器 withRetry）', async () => {
    const deps = makeDeps();
    deps.chatCompletion.mockResolvedValue({ items: 'nope' });
    const llm = createLlmAdapter(deps);

    await expect(llm.extractConsensus(msgs)).rejects.toThrow();
  });

  it('sources 非数组时按空数组处理', async () => {
    const deps = makeDeps();
    deps.chatCompletion.mockResolvedValue({
      items: [{ type: 'consensus', content: 'A', sources: '不是数组' }],
    });
    const llm = createLlmAdapter(deps);

    await expect(llm.extractConsensus(msgs)).resolves.toEqual({
      items: [{ type: 'consensus', content: 'A', sources: [] }],
    });
  });
});

describe('llmAdapter.streamSpeech', () => {
  it('转发 messages / onChunk，返回完整文本', async () => {
    const deps = makeDeps();
    deps.streamSpeech.mockImplementation(
      async (_messages: unknown, onChunk: (chunk: string) => void) => {
        onChunk('你');
        onChunk('好');
        return '你好';
      },
    );
    const llm = createLlmAdapter(deps);
    const chunks: string[] = [];

    await expect(llm.streamSpeech(msgs, (c) => chunks.push(c))).resolves.toBe('你好');
    expect(chunks).toEqual(['你', '好']);
    expect(deps.streamSpeech).toHaveBeenCalledWith(msgs, expect.any(Function));
  });
});
