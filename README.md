# AI Panel Studio

AI 圆桌讨论 Web App MVP — 一键召唤虚拟智囊团，围绕任意议题展开深度圆桌讨论。

## 技术栈

### 后端
- Node.js + Express + TypeScript
- Prisma ORM + SQLite
- SSE（Server-Sent Events）实时推送

### 前端
- React 18 + TypeScript + Vite
- Tailwind CSS
- React Router + Zustand

## 快速开始

### 环境要求
- Node.js >= 18
- npm >= 9

### 安装依赖

```bash
# 后端
cd backend
npm install

# 前端
cd ../frontend
npm install
```

### 配置环境变量

```bash
cd backend
cp .env.example .env
# 编辑 .env，填入你的 LLM API Key
```

### 初始化数据库

```bash
cd backend
npx prisma generate
npx prisma migrate dev --name init
```

### 启动开发服务

```bash
# 后端（端口 3001）
cd backend
npm run dev

# 前端（端口 5173）
cd frontend
npm run dev
```

访问 http://localhost:5173 即可使用。

## 项目结构

```
ai-panel-studio/
├── backend/              # 后端服务
│   ├── src/
│   │   ├── controllers/  # 控制器
│   │   ├── routes/       # 路由
│   │   ├── services/     # 业务逻辑
│   │   ├── middleware/   # 中间件
│   │   ├── utils/        # 工具函数
│   │   └── index.ts      # 入口
│   ├── prisma/           # 数据库 schema
│   └── package.json
├── frontend/             # 前端应用
│   ├── src/
│   │   ├── pages/        # 页面组件
│   │   ├── components/   # 公共组件
│   │   ├── store/        # 状态管理
│   │   ├── services/     # API 服务
│   │   ├── types/        # 类型定义
│   │   ├── utils/        # 工具函数
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── package.json
├── docs/                 # 文档
│   ├── PRD.md
│   ├── ER图.md
│   ├── API文档.md
│   ├── prompt记录.md
│   └── 工作流说明.md
└── package.json
```

## 功能清单

### 已完成
- [x] 项目脚手架搭建
- [x] 前后端基础结构
- [x] 数据模型设计（Prisma schema）
- [x] 前端路由与页面骨架
- [x] 文档模板

### 待完成
- [ ] 嘉宾生成功能
- [ ] 讨论编排逻辑
- [ ] SSE 实时事件流
- [ ] 共识与分歧提炼
- [ ] 演播厅前端交互
- [ ] 单元测试
- [ ] E2E 测试
- [ ] 示例数据（seed）

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| PORT | 后端服务端口 | 3001 |
| DATABASE_URL | SQLite 数据库路径 | file:./dev.db |
| LLM_API_KEY | 大模型 API Key | - |
| LLM_BASE_URL | 大模型 API 地址 | https://api.deepseek.com/v1 |
| LLM_MODEL | 模型名称 | deepseek-chat |

## 测试

### 后端单元测试

```bash
cd backend
npm test          # 当前 66 项；LLM / DB 全部 mock，不产生真实调用
```

### 前端单元测试

```bash
cd frontend
npm install
npm test          # 14 项 applyEvent reducer 测试，无 DOM / 网络
```

### E2E（Playwright）

```bash
cd frontend
npx playwright install chromium   # 首次需要
npm run test:e2e                  # 7 条确定性用例，基于 seed 数据，不调用 LLM
npm run test:e2e:slow             # @slow：真实调用 LLM 跑 2 专家讨论（需 API 余额，约 2~4 分钟）
```

- 前置：数据库需要有 seed 数据：`cd backend && npm run db:seed`；或 `npm run db:reset` 一键重建。
- `playwright.config.ts` 通过 `webServer` 自动拉起 backend(3001) / frontend(5173)；
  端口已有实例时会复用（`reuseExistingServer: true`）。
- 默认的 `test:e2e` 使用 `--grep-invert @slow`，**不会**调用 LLM；只有 `test:e2e:slow` 需要真实 API 余额。
- `@slow` 用例结束后会清理自己创建的 `[E2E]` 讨论。

## 开发范式

本项目遵循四阶段开发范式：

1. **SDD 阶段**：数据建模与 API 契约生成
2. **DDD 阶段**：前端组件与页面生成
3. **TDD 阶段**：核心逻辑的测试用例编写与业务实现
4. **E2E 阶段**：系统级端到端测试与质量闭环

详见 `docs/` 目录下的相关文档。

## License

MIT
