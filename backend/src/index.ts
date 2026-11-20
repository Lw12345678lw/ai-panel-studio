import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { discussionsRouter } from './routes/discussions';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: 'AI Panel Studio API is running' });
});

app.use('/api/discussions', discussionsRouter);

// 兜底错误处理
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
