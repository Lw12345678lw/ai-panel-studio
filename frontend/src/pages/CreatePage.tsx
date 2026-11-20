import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { discussionApi } from '../services/api';

type SubmitStage = 'creating' | 'generating' | null;

export default function CreatePage() {
  const [topic, setTopic] = useState('');
  const [expertCount, setExpertCount] = useState(4);
  const [stage, setStage] = useState<SubmitStage>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const loading = stage !== null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || loading) return;

    setError('');
    setStage('creating');
    try {
      const discussion = await discussionApi.create(topic.trim(), expertCount);
      setStage('generating');
      await discussionApi.generatePanel(discussion.id);
      navigate(`/studio/${discussion.id}`);
    } catch {
      setError('创建讨论或生成嘉宾失败，请检查后端服务与 API 配置后重试。');
      setStage(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <button
          onClick={() => navigate('/')}
          className="text-gray-400 hover:text-white mb-8 flex items-center gap-2"
        >
          ← 返回首页
        </button>

        <h1 className="text-3xl font-bold mb-2">发起新讨论</h1>
        <p className="text-gray-400 mb-8">输入讨论话题，AI 将为你生成专属专家阵容</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 话题输入 */}
          <div>
            <label htmlFor="discussion-topic" className="block text-sm font-medium text-gray-300 mb-2">
              讨论话题
            </label>
            <textarea
              id="discussion-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例如：人工智能对就业市场的长期影响"
              className="w-full h-32 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 resize-none"
            />
          </div>

          {/* 专家人数 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              专家人数：{expertCount} 人
            </label>
            <input
              type="range"
              min="2"
              max="8"
              value={expertCount}
              onChange={(e) => setExpertCount(Number(e.target.value))}
              className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-purple-500"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>2人</span>
              <span>8人</span>
            </div>
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          )}

          {/* 提交按钮 */}
          <button
            type="submit"
            disabled={loading || !topic.trim()}
            className="w-full py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed rounded-xl text-lg font-semibold transition-all"
          >
            {stage === 'creating'
              ? '创建讨论中...'
              : stage === 'generating'
                ? 'AI 正在生成嘉宾阵容...'
                : '生成嘉宾阵容 →'}
          </button>
          {stage === 'generating' && (
            <p className="text-center text-sm text-gray-400">通常需要 3～25 秒，请保持页面打开。</p>
          )}
        </form>

        {/* 示例话题 */}
        <div className="mt-12">
          <p className="text-sm text-gray-400 mb-3">试试这些话题：</p>
          <div className="flex flex-wrap gap-2">
            {[
              'AI 会取代程序员吗？',
              '远程办公是未来趋势吗？',
              '新能源汽车的下一个五年',
              '年轻人该不该买房？',
            ].map((t, i) => (
              <button
                key={i}
                onClick={() => setTopic(t)}
                className="px-3 py-1.5 text-sm bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-gray-300 transition-colors"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
