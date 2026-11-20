// panelService.test.ts — TDD：嘉宾生成服务的契约测试
// 所有 API 调用通过 mock global.fetch 完成，绝不真实调用 DeepSeek。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generatePanel, PanelGenerationError } from '../src/services/panelService';

// 辅助：构造 OpenAI 兼容响应（HTTP 层 envelope 恒为合法 JSON）
function makeEnvelope(content: string) {
  const body = {
    choices: [{ message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
  };
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

// 辅助：构造合法嘉宾 JSON 数组（1 host + N expert，颜色互不重复）
function makePanel(expertCount: number) {
  const colors = [
    '#3B82F6', '#10B981', '#EF4444', '#F59E0B', '#8B5CF6',
    '#EC4899', '#14B8A6', '#F97316', '#6366F1',
  ];
  const host = {
    name: '主持人', title: '论坛主持人', position: '某研究院',
    stance: '中立视角', color: colors[0], role: 'host',
  };
  const experts = Array.from({ length: expertCount }, (_, i) => ({
    name: `专家${i + 1}`,
    title: `头衔${i + 1}`,
    position: `机构${i + 1}`,
    stance: `立场${i + 1}`,
    color: colors[i + 1],
    role: 'expert',
  }));
  return [host, ...experts];
}

describe('generatePanel', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('正常：4 人 → 1 host + 4 expert，6 字段齐全，颜色合法且互不重复', async () => {
    fetchMock.mockResolvedValue(makeEnvelope(JSON.stringify(makePanel(4))));

    const result = await generatePanel('人工智能对就业市场的影响', 4);

    expect(result).toHaveLength(5);
    expect(result.filter((m) => m.role === 'host')).toHaveLength(1);
    expect(result.filter((m) => m.role === 'expert')).toHaveLength(4);

    for (const m of result) {
      expect(m.name.trim()).not.toBe('');
      expect(m.title.trim()).not.toBe('');
      expect(m.position.trim()).not.toBe('');
      expect(m.stance.trim()).not.toBe('');
      expect(m.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(['host', 'expert']).toContain(m.role);
    }

    const colors = result.map((m) => m.color.toLowerCase());
    expect(new Set(colors).size).toBe(result.length);
  });

  it('边界：2 人 → 1 host + 2 expert', async () => {
    fetchMock.mockResolvedValue(makeEnvelope(JSON.stringify(makePanel(2))));

    const result = await generatePanel('话题', 2);

    expect(result).toHaveLength(3);
    expect(result.filter((m) => m.role === 'host')).toHaveLength(1);
    expect(result.filter((m) => m.role === 'expert')).toHaveLength(2);
  });

  it('边界：8 人 → 1 host + 8 expert', async () => {
    fetchMock.mockResolvedValue(makeEnvelope(JSON.stringify(makePanel(8))));

    const result = await generatePanel('话题', 8);

    expect(result).toHaveLength(9);
    expect(result.filter((m) => m.role === 'host')).toHaveLength(1);
    expect(result.filter((m) => m.role === 'expert')).toHaveLength(8);
  });

  it('异常：模型返回非 JSON → 重试一次后仍失败 → 抛 PanelGenerationError', async () => {
    fetchMock.mockResolvedValue(makeEnvelope('抱歉，我无法生成 JSON 数组'));

    const err = await generatePanel('话题', 4).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PanelGenerationError);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 初始 1 次 + 重试 1 次
  });

  it('异常：API 超时 → 抛明确的超时错误', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);

    const err = await generatePanel('话题', 4).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PanelGenerationError);
    expect((err as Error).message).toMatch(/超时|timeout/i);
  });

  // ===== 脏数据测试 =====

  it('脏数据：缺 stance 字段 → 抛 PanelGenerationError', async () => {
    const panel = makePanel(4);
    delete (panel[0] as { stance?: string }).stance;
    fetchMock.mockResolvedValue(makeEnvelope(JSON.stringify(panel)));

    const err = await generatePanel('话题', 4).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PanelGenerationError);
  });

  it('脏数据：host 数量为 0 → 抛 PanelGenerationError', async () => {
    const panel = makePanel(4).filter((m) => m.role !== 'host'); // 4 专家，0 主持
    fetchMock.mockResolvedValue(makeEnvelope(JSON.stringify(panel)));

    const err = await generatePanel('话题', 4).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PanelGenerationError);
  });

  it('脏数据：host 数量为 2 → 抛 PanelGenerationError', async () => {
    const panel = makePanel(4);
    panel[1].role = 'host'; // 2 host + 3 expert
    fetchMock.mockResolvedValue(makeEnvelope(JSON.stringify(panel)));

    const err = await generatePanel('话题', 4).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PanelGenerationError);
  });

  it('脏数据：要 4 专家只返回 3 个 → 抛 PanelGenerationError', async () => {
    const panel = makePanel(3); // 1 host + 3 expert
    fetchMock.mockResolvedValue(makeEnvelope(JSON.stringify(panel)));

    const err = await generatePanel('话题', 4).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PanelGenerationError);
  });

  it('脏数据：color 为 "blue" → 抛 PanelGenerationError', async () => {
    const panel = makePanel(4);
    panel[0].color = 'blue';
    fetchMock.mockResolvedValue(makeEnvelope(JSON.stringify(panel)));

    const err = await generatePanel('话题', 4).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PanelGenerationError);
  });

  it('脏数据：name 为空白字符串 → 抛 PanelGenerationError', async () => {
    const panel = makePanel(4);
    panel[0].name = '   ';
    fetchMock.mockResolvedValue(makeEnvelope(JSON.stringify(panel)));

    const err = await generatePanel('话题', 4).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PanelGenerationError);
  });

  it('脏数据：两位专家同名 → 重试后仍失败 → 抛 PanelGenerationError', async () => {
    const panel = makePanel(4);
    panel[2].name = panel[1].name; // 两位专家重名
    fetchMock.mockResolvedValue(makeEnvelope(JSON.stringify(panel)));

    const err = await generatePanel('话题', 4).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PanelGenerationError);
    expect((err as Error).message).toMatch(/重名|重复/);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 内容性错误重试 1 次
  });

  it('脏数据：两人颜色重复 → 自动修复（从备用调色板分配未用色），修复后不重复', async () => {
    const panel = makePanel(4);
    panel[1].color = panel[0].color; // 让第 2 人与主持人颜色相同
    fetchMock.mockResolvedValue(makeEnvelope(JSON.stringify(panel)));

    const result = await generatePanel('话题', 4);

    expect(result).toHaveLength(5);
    const colors = result.map((m) => m.color.toLowerCase());
    expect(new Set(colors).size).toBe(result.length); // 修复后无重复
    expect(result.every((m) => /^#[0-9a-fA-F]{6}$/.test(m.color))).toBe(true);
  });
});
