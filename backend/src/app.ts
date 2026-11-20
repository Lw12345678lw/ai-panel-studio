import express from 'express';
import cors from 'cors';
import { createDiscussionsRouter, type DiscussionsRouterDeps } from './routes/discussions';

export type AppDeps = DiscussionsRouterDeps;

export function createApp(deps: AppDeps) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // 健康检查
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', message: 'AI Panel Studio API is running' });
  });

  app.use('/api/discussions', createDiscussionsRouter(deps));

  // 兜底错误处理
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    if (res.headersSent) {
      // SSE 等已开始响应的场景：不能再写 JSON，直接结束
      res.end();
      return;
    }
    res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}
