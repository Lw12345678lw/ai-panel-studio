# AI Panel Studio

AI 圆桌讨论 Web App MVP — 输入任意话题，一键召唤虚拟智囊团，围绕议题展开多轮实时圆桌讨论。

> 用户输入话题并指定专家人数 → 大模型生成持不同立场的「主持人 + 专家」阵容 → 演播厅内多轮实时发言、相互回应 → 讨论中实时提炼共识与分歧 → 主持人收尾总结，形成一份可回放的结构化讨论记录。

---

## 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 后端 | Node.js + Express + TypeScript | 与前端同语言，降低协作成本 |
| ORM | Prisma 6 + SQLite | 零配置本地库；**锁定 6.x**，Prisma 7 有破坏性变更（见下文） |
| 实时通信 | SSE（Server-Sent Events） | 讨论是服务端单向推送，SSE 比 WebSocket 更轻、自带重连 |
| 前端 | React 18 + Vite + TypeScript | 演播厅交互复杂，需要组件化与强类型 |
| 样式 | Tailwind CSS | 快速构建深色沉浸式界面 |
| 状态 | Zustand + 纯 reducer | 事件驱动状态收敛，reducer 可脱离 React 单测 |
| 大模型 | DeepSeek（OpenAI 兼容协议） | 中文语义质量好；通过环境变量可替换任意兼容模型 |
| 测试 | Vitest + Playwright | 单元测试 + 端到端 |

### 关键技术决策

1. **嘉宾生成走同步接口，不走 SSE**：嘉宾生成是一次性调用、一次性返回，中间没有真实事件可推；用 SSE 只能推假进度。SSE 只服务于演播厅的真实持续事件流。
2. **专家运行时状态不落库**：`idle / preparing / speaking` 是高频瞬态，只存在内存 + SSE 推送，避免"数据库与内存双真相源"。
3. **每条共识/分歧必须可溯源**：通过 `ConsensusItemMessage` join 表关联到具体发言，使"避免大模型幻觉"从口号变成可断言的测试。
4. **Prisma 锁定 6.x**：Prisma 7 要求连接串移入 `prisma.config.ts` 并使用 driver adapter（Windows 下需编译原生模块），对 MVP 零收益。

---

## 快速开始

### 环境要求
- Node.js >= 18
- npm >= 9

### 1. 安装依赖

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. 配置环境变量

```bash
cd backend
cp .env.example .env
```

编辑 `backend/.env`：

```env
PORT=3001
DATABASE_URL="file:./dev.db"
LLM_API_KEY=你的_deepseek_api_key
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-v4-flash
```

> API Key 仅在服务端读取，不会下发到前端。

### 3. 初始化数据库 + 示例数据

```bash
cd backend
npm run db:reset     # 删除旧库 → migrate → seed（推荐）
```

或分步执行：

```bash
npx prisma migrate dev
npm run db:seed
```

示例数据包含 5 场讨论：
- 「AI 会取代人类工作吗？」— 已结束，4 轮 16 条发言、共识 3 + 分歧 2
- 「远程办公是未来趋势吗？」— 进行中，4 轮 14 条发言
- 「高校该不该全面推行 AI 教学？」— 已结束，2 轮 10 条发言
- 「年轻人该不该买房？」— 待开始，已有 5 人阵容
- 「新能源汽车的下一个五年」— 生成中状态

### 4. 启动开发服务

```bash
# 终端 1：后端 http://localhost:3001
cd backend && npm run dev

# 终端 2：前端 http://localhost:5173
cd frontend && npm run dev
```

访问 http://localhost:5173

### 5. 发起一场真实讨论

首页点「发起新讨论」→ 输入任意话题（不在示例数据中的也可以）→ 选择专家人数 → 生成阵容 → 进入演播厅点「开始讨论」。

此时会真实调用大模型：生成阵容约 3~25 秒，完整讨论约 1~4 分钟。

---

## 项目结构

```
ai-panel-studio/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          # 数据模型（Discussion/PanelMember/Round/Message/ConsensusItem/ConsensusItemMessage）
│   │   ├── seed.ts                # 示例数据（5 场讨论，幂等）
│   │   └── migrations/            # 数据库迁移
│   ├── src/
│   │   ├── app.ts                 # createApp：依赖注入装配
│   │   ├── index.ts               # 启动入口 + 残留状态收敛
│   │   ├── db.ts                  # Prisma 客户端单例
│   │   ├── routes/discussions.ts  # REST + SSE 路由
│   │   ├── services/
│   │   │   ├── llm.ts             # LLM 底层封装（请求/超时/重试/JSON 解析/流式）
│   │   │   ├── llmAdapter.ts      # 适配编排器接口（选人/共识结构校验）
│   │   │   ├── panelService.ts    # 嘉宾生成（prompt + 结构校验 + 颜色去重）
│   │   │   ├── orchestrator.ts    # 讨论编排：固定状态机 + LLM 内容生成
│   │   │   ├── sseHub.ts          # 进程内事件中枢（按讨论隔离 + history 回放）
│   │   │   └── db.ts              # 应用层数据访问
│   │   └── scripts/llm-smoke.ts   # LLM 连通性排查工具
│   └── tests/                     # 69 项单元测试
├── frontend/
│   ├── src/
│   │   ├── pages/                 # HomePage / CreatePage / StudioPage
│   │   ├── components/studio/     # PanelSeat / TranscriptPanel / ConsensusPanel / StudioStatusPill
│   │   ├── store/                 # reducer（纯函数）+ studioStore（zustand）
│   │   ├── hooks/                 # useDiscussionStream（SSE 生命周期）/ useTypewriter
│   │   ├── services/              # api.ts / sse.ts
│   │   └── types/                 # 前后端共享类型
│   ├── tests/                     # 14 项 reducer 测试
│   ├── e2e/                       # Playwright（9 条确定性 + 1 条 @slow）
│   └── playwright.config.ts
└── docs/
    ├── PRD.md                     # 产品需求
    ├── ER图.md                    # 数据模型与 ER 图
    ├── API文档.md                 # REST + SSE 事件契约
    ├── prompt记录.md              # 核心 Prompt 记录（四阶段）
    ├── 开发进度.md                # 进度与决策记录
    └── 工作流说明.md              # 开发过程与典型问题
```

---

## 架构说明

```
浏览器
  │  GET /api/discussions/:id/stream        （订阅 SSE，长连接）
  │  POST /api/discussions/:id/start        （异步拉起编排，立即返回）
  ▼
Express 路由层  ── 原子抢占 waiting→ongoing（防重复启动）
  │
  ├─► sseHub（按 discussionId 隔离的事件中枢 + history 回放）
  │        ▲
  │        │ emit(event)
  │        │
  └─► orchestrator（固定状态机：开场 → 逐轮 → 收尾）
           │  每轮：主持人子问题 → 选人 → 专家发言 → 追问 → 关轮触发共识提炼
           ├─► llmAdapter ─► DeepSeek API（流式）
           └─► Prisma（Round / Message / ConsensusItem / 溯源 join）
```

**设计原则：流程骨架用规则定死（可测、可界定结束），内容由 LLM 生成（自然、有交锋）。**
主持人"说什么"由 LLM 决定，"下一步做什么"由代码状态机决定，避免模型自主决策导致跑题或死循环。

---

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| PORT | 后端服务端口 | 3001 |
| DATABASE_URL | SQLite 数据库路径 | file:./dev.db |
| LLM_API_KEY | 大模型 API Key（仅服务端） | - |
| LLM_BASE_URL | 大模型 API 地址（OpenAI 兼容） | https://api.deepseek.com/v1 |
| LLM_MODEL | 模型名称 | deepseek-v4-flash |

---

## 主要接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/discussions` | 讨论列表（降序，summary 截断 100 字） |
| POST | `/api/discussions` | 创建讨论 |
| POST | `/api/discussions/:id/generate-panel` | 生成嘉宾阵容（同步，约 3~25 秒） |
| POST | `/api/discussions/:id/start` | 开始讨论（异步拉起编排） |
| GET | `/api/discussions/:id` | 讨论详情 |
| GET | `/api/discussions/:id/members` | 嘉宾列表（主持人优先） |
| GET | `/api/discussions/:id/messages` | 发言记录（升序） |
| GET | `/api/discussions/:id/consensus` | 共识与分歧（含 sourceMessageIds） |
| GET | `/api/discussions/:id/rounds` | 轮次列表（按 seq 升序） |
| GET | `/api/discussions/:id/stream` | **SSE** 事件流 |

完整契约（含 SSE 事件类型、`Last-Event-ID` 回放、心跳、状态码）见 `docs/API文档.md`。

---

## 测试

### 后端单元测试（69 项）

```bash
cd backend && npm test
```

覆盖：嘉宾生成（正常/边界/脏数据/颜色修复/重名）、讨论编排（轮数驱动/选人护栏/最低人数/共识溯源/SSE 事件/重试/超时）、SSE 中枢（隔离/回放/清理）、路由（创建/启动/只读查询/列表）。
**LLM 与 DB 全部 mock，不产生真实调用。**

### 前端单元测试（14 项）

```bash
cd frontend && npm test
```

覆盖纯 reducer：`speech_chunk` 累积、`message.id` 去重、回放幂等、`finished` 收敛、hydrate。

### E2E（Playwright）

```bash
cd frontend
npx playwright install chromium   # 首次
npm run test:e2e                  # 9 条确定性用例，基于 seed 数据，不调用 LLM
npm run test:e2e:slow             # @slow：真实跑一场 2 专家讨论（需 API 余额，2~4 分钟）
```

E2E 设计原则：**默认用例绝不调用大模型**——真实 LLM 慢、花钱、结果不确定，会让测试不可靠。默认 9 条覆盖首页列表、三种状态的演播厅渲染、刷新恢复、404 页、发起讨论的成功与失败路径；真实全链路单独标记 `@slow`，手动触发。

---

## 开发范式

本项目按四阶段推进，每个阶段都有明确产出物与验收标准：

1. **SDD** — 冻结数据模型与 API/SSE 契约
2. **DDD** — 页面与组件结构，假数据跑通流转
3. **TDD** — 先写测试（红）再实现（绿），覆盖核心业务逻辑
4. **E2E** — 系统级端到端质量闭环

过程中累计沉淀 17 条关键决策与 4 个典型问题的排查记录，详见 `docs/工作流说明.md`。

---

## License

MIT
