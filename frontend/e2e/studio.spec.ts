// studio.spec.ts — 默认 E2E：全部基于 seed 数据，绝不调用 LLM。
import { test, expect } from '@playwright/test';

const card = (page: import('@playwright/test').Page, topic: string) =>
  page.getByTestId('discussion-card').filter({ hasText: topic });

test.describe('演播厅确定性 E2E（seed 数据）', () => {
  test('首页显示 5 条讨论，状态徽章文案正确', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: '全部讨论' })).toBeVisible();
    await expect(page.getByTestId('discussion-card')).toHaveCount(5);

    await expect(card(page, '年轻人该不该买房？').getByTestId('status-badge')).toHaveText('待开始');
    await expect(
      card(page, '新能源汽车的下一个五年').getByTestId('status-badge'),
    ).toHaveText('生成中');
    await expect(
      card(page, '远程办公是未来趋势吗？').getByTestId('status-badge'),
    ).toHaveText('进行中');
    await expect(
      card(page, 'AI 会取代人类工作吗？').getByTestId('status-badge'),
    ).toHaveText('已结束');
    await expect(
      card(page, '高校该不该全面推行 AI 教学？').getByTestId('status-badge'),
    ).toHaveText('已结束');
  });

  test('finished：16 条发言、5 位嘉宾、共识非空、有最终总结', async ({ page }) => {
    await page.goto('/');
    await card(page, 'AI 会取代人类工作吗？').click();

    await expect(page).toHaveURL(/\/studio\/seed-ai-jobs-finished$/);
    await expect(page.getByTestId('transcript-message')).toHaveCount(16);
    await expect(page.getByTestId('panel-seat')).toHaveCount(5);
    await expect(page.getByTestId('consensus-item')).toHaveCount(5);
    await expect(page.getByTestId('summary')).toBeVisible();
    await expect(page.getByTestId('summary')).toContainText('本场讨论逐步收敛');
  });

  test('ongoing：显示「直播中」，不出现全屏 loading', async ({ page }) => {
    await page.goto('/');
    await card(page, '远程办公是未来趋势吗？').click();

    await expect(page).toHaveURL(/\/studio\/seed-remote-work-ongoing$/);
    await expect(page.getByTestId('status-pill')).toContainText('直播中', { timeout: 15_000 });
    await expect(page.getByTestId('transcript-message')).toHaveCount(14);
    await expect(
      page.getByText('本轮发言已结束，主持人正在组织下一轮…'),
    ).toBeVisible();
    await expect(page.getByText('正在进入演播厅…')).toHaveCount(0);
  });

  test('generating：显示「嘉宾生成中…」与引导条，不卡 loading（回归）', async ({ page }) => {
    await page.goto('/');
    await card(page, '新能源汽车的下一个五年').click();

    await expect(page).toHaveURL(/\/studio\/seed-ev-generating$/);
    await expect(page.getByTestId('status-pill')).toContainText('嘉宾生成中…');
    await expect(page.getByTestId('panel-guidance')).toBeVisible();
    await expect(page.getByRole('button', { name: /重新生成阵容/ })).toBeVisible();

    // 回归：曾经的卡死症状是全屏「正在进入演播厅…」
    await expect(page.getByText('正在进入演播厅…')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /开始讨论/ })).toHaveCount(0);
  });

  test('waiting：「开始讨论」可见且 enabled', async ({ page }) => {
    await page.goto('/');
    await card(page, '年轻人该不该买房？').click();

    await expect(page).toHaveURL(/\/studio\/seed-housing-waiting$/);
    const start = page.getByRole('button', { name: /开始讨论/ });
    await expect(start).toBeVisible();
    await expect(start).toBeEnabled();
    await expect(page.getByTestId('panel-seat')).toHaveCount(5);
  });

  test('刷新 finished 页面：内容仍在，不白屏', async ({ page }) => {
    await page.goto('/studio/seed-ai-jobs-finished');
    await expect(page.getByTestId('transcript-message')).toHaveCount(16);
    await expect(page.getByTestId('summary')).toBeVisible();

    await page.reload();

    await expect(page.getByTestId('transcript-message')).toHaveCount(16);
    await expect(page.getByTestId('panel-seat')).toHaveCount(5);
    await expect(page.getByTestId('summary')).toBeVisible();
  });

  test('不存在的 id：错误页 + 返回首页', async ({ page }) => {
    await page.goto('/studio/does-not-exist');

    await expect(page.getByText('加载失败')).toBeVisible();
    await expect(page.getByText(/讨论不存在|HTTP 404/)).toBeVisible();

    await page.getByRole('button', { name: '返回首页' }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: '全部讨论' })).toBeVisible();
  });
});

test.describe('发起讨论（mock API，不调用 LLM）', () => {
  test('依次创建讨论、生成阵容，成功后进入对应演播厅', async ({ page }) => {
    const calls: string[] = [];
    let releasePanel!: () => void;
    const panelGate = new Promise<void>((resolve) => {
      releasePanel = resolve;
    });

    await page.route('**/api/discussions', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      calls.push('create');
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'e2e-created-discussion' }),
      });
    });
    await page.route('**/api/discussions/e2e-created-discussion/generate-panel', async (route) => {
      calls.push('generate-panel');
      await panelGate;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.goto('/create');
    await page.getByLabel('讨论话题').fill('人工智能对市场的影响');
    await page.getByRole('button', { name: '生成嘉宾阵容 →' }).click();

    await expect(page.getByRole('button', { name: 'AI 正在生成嘉宾阵容...' })).toBeDisabled();
    releasePanel();
    await expect(page).toHaveURL(/\/studio\/e2e-created-discussion$/);
    expect(calls).toEqual(['create', 'generate-panel']);
  });

  test('生成阵容失败时显示页面内错误，并允许重试', async ({ page }) => {
    await page.route('**/api/discussions', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'e2e-created-discussion' }),
      });
    });
    await page.route('**/api/discussions/e2e-created-discussion/generate-panel', async (route) => {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: '模型暂时不可用' }),
      });
    });

    await page.goto('/create');
    await page.getByLabel('讨论话题').fill('人工智能对市场的影响');
    await page.getByRole('button', { name: '生成嘉宾阵容 →' }).click();

    await expect(page.getByRole('alert')).toContainText('创建讨论或生成嘉宾失败');
    await expect(page).toHaveURL(/\/create$/);
    await expect(page.getByRole('button', { name: '生成嘉宾阵容 →' })).toBeEnabled();
  });
});
