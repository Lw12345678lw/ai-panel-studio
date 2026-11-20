// slow.spec.ts — @slow 真实全链路：会用真实 LLM 跑一场 2 专家讨论。
// 默认被 `--grep-invert @slow` 跳过；用 npm run test:e2e:slow 手动执行。
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';
const TOPIC_PREFIX = '[E2E]';

test.describe('@slow 真实全链路', () => {
  test.afterAll(() => {
    // 清理本次 slow 测试创建的真实讨论（级联删除消息/轮次/共识）
    try {
      const backendDir = path.resolve(process.cwd(), '../backend');
      const script = [
        "const { PrismaClient } = require('@prisma/client');",
        'const p = new PrismaClient();',
        `p.discussion.deleteMany({ where: { topic: { startsWith: '${TOPIC_PREFIX}' } } })`,
        "  .then((r) => { console.log('[slow cleanup] removed', r.count); return p.$disconnect(); })",
        '  .catch(async (e) => {',
        '    console.error(e);',
        '    await p.$disconnect();',
        '    process.exit(1);',
        '  });',
      ].join('\n');
      execFileSync(process.execPath, ['-e', script], { cwd: backendDir, stdio: 'inherit' });
    } catch (e) {
      console.warn('[slow cleanup] failed:', e);
    }
  });

  test('@slow 新建 2 专家讨论 → 生成阵容 → 跑到结束', async ({ page, request }) => {
    test.slow();
    test.setTimeout(8 * 60_000);

    const createRes = await request.post(`${API}/discussions`, {
      data: { topic: `${TOPIC_PREFIX}AI 会取代人类工作吗？`, expertCount: 2 },
    });
    expect(createRes.ok()).toBeTruthy();
    const discussion = await createRes.json();

    const panelRes = await request.post(
      `${API}/discussions/${discussion.id}/generate-panel`,
      { timeout: 180_000 },
    );
    expect(panelRes.ok()).toBeTruthy();

    await page.goto(`/studio/${discussion.id}`);
    await expect(page.getByTestId('panel-seat')).toHaveCount(3);

    await page.getByRole('button', { name: /开始讨论/ }).click();

    await expect(page.getByTestId('summary')).toBeVisible({ timeout: 6 * 60_000 });
    await expect(page.getByTestId('status-pill')).toContainText('讨论已结束');
    expect(await page.getByTestId('transcript-message').count()).toBeGreaterThan(0);
  });
});
