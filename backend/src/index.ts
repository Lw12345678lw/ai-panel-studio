import dotenv from 'dotenv';
dotenv.config();

import { createApp } from './app';
import { appDb } from './services/db';
import { llmAdapter } from './services/llmAdapter';
import { createSseHub } from './services/sseHub';

const PORT = process.env.PORT || 3001;

const hub = createSseHub();
const app = createApp({ db: appDb, llm: llmAdapter, hub });

// 进程重启后内存中的编排已丢失，把残留的 ongoing 收敛为 finished，避免状态卡死
appDb
  .finishStaleOngoing()
  .catch((e) => console.error('启动时收敛残留 ongoing 讨论失败：', e));

app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
