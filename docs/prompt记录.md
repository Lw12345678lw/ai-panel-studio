# 核心 Prompt 记录文档

> 记录引导 AI 开发的最核心原始 Prompt，体现多范式的阶段性。
> 每段 Prompt 后附 1-2 句说明（当时意图、遇到了什么挑战、如何引导 AI 修正）。

---

## 阶段一：SDD 阶段 — 数据建模与 API 契约生成

### Prompt 1：五维度审视数据模型

```
不要急着写业务代码。我们先把 SDD 阶段做完：数据建模与 API 契约必须完全定型。
请基于 backend/prisma/schema.prisma 从 5 个维度分析当前设计的不足：
1. 讨论编排是否需要「轮次（Round）」实体？
2. 专家的「举手/抢答/准备发言」内部状态要不要持久化？
3. 多讨论并行时，状态隔离在数据库层如何保证？
4. ConsensusItem 是否需要追溯来源？
5. summary 和「最终共识」是不是同一个东西？
每问给判断+理由，并给保守方案（MVP）与完整方案（生产级）及优缺点。不要改代码，等我确认。
```

**说明：** 意图是让数据模型在写代码前经受结构化拷问。引导 AI 输出「保守/完整」两档方案供选择，最终拍板走保守方案（轻量 Round + 追溯 join 表 + 移除瞬态 status），避免过度建模。

### Prompt 2：定型契约并落地

```
确认按保守方案推进（5 项），但否决 String→Prisma enum（SQLite 不支持），
改用注释 + Zod + 前端 union 三层约束；同步移除 PanelMember.status，
运行时状态按 Map<discussionId, Map<memberId, RuntimeState>> 设计。
执行：改 schema → prisma migrate dev → 同步 ER图.md / API文档.md。
```

**说明：** 意图是契约「完全定型」并落到迁移与文档。过程中遇到 Prisma 7 移除 `datasource.url` 的破坏性变更（P1012），经用户拍板降级到 Prisma 6.19.3 才解除阻塞。

---

## 阶段二：DDD 阶段 — 前端组件与页面生成

### Prompt 3：设计演播厅页面布局

```
（待补充）
```

**说明：** （待补充）

### Prompt 4：实现嘉宾小窗组件

```
（待补充）
```

**说明：** （待补充）

---

## 阶段三：TDD 阶段 — 核心逻辑的测试用例编写与业务实现

### Prompt 5：嘉宾生成功能 TDD

```
先写测试 backend/tests/panelService.test.ts（mock 所有 API，绝不真实调用 DeepSeek）：
- 正常：话题 + 4 人 → 1 host + 4 expert，6 字段齐全，颜色合法且互不重复
- 边界：2 人、8 人
- 异常：非 JSON → 触发重试，重试仍失败抛自定义错误；超时 → 明确错误
先跑测试确认全红，我确认后再写实现（llm.ts 通用封装 + panelService.ts 校验）。
补 6 条脏数据测试：缺 stance / host 数量 0 或 2 / 专家数不符 / color 非法 /
name 空白 / 颜色重复（重复自动修复）。
```

**说明：** 意图是先固化契约再实现，强制 mock 杜绝真实调用。过程中纠正了一个计时 bug——`fetch()` 在响应头到达即 resolve，真实完整耗时须在 `await res.text()` 读完 body 后计时。用户追加「立场多样性」硬要求（覆盖争议维度、禁止中立套话、主持人中立），写入 system prompt。

---

## 阶段四：E2E 阶段 — 系统级端到端测试与质量闭环

### Prompt 6：端到端测试

```
（待补充）
```

**说明：** （待补充）
