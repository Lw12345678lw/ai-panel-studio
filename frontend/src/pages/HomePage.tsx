import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { discussionApi } from '../services/api';
import type { Discussion, DiscussionStatus } from '../types';

const STATUS_META: Record<
  DiscussionStatus,
  { label: string; badge: string; dot: string }
> = {
  waiting: {
    label: '待开始',
    badge: 'border-amber-500/30 bg-amber-500/15 text-amber-300',
    dot: 'bg-amber-400',
  },
  generating: {
    label: '生成中',
    badge: 'border-sky-500/30 bg-sky-500/15 text-sky-300',
    dot: 'bg-sky-400 animate-pulse',
  },
  ongoing: {
    label: '进行中',
    badge: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
    dot: 'bg-emerald-400 animate-pulse',
  },
  finished: {
    label: '已结束',
    badge: 'border-purple-500/30 bg-purple-500/15 text-purple-300',
    dot: 'bg-purple-400',
  },
};

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function DiscussionCard({ discussion }: { discussion: Discussion }) {
  const navigate = useNavigate();
  const meta = STATUS_META[discussion.status] ?? STATUS_META.waiting;

  return (
    <button
      data-testid="discussion-card"
      onClick={() => navigate(`/studio/${discussion.id}`)}
      className="group flex w-full flex-col rounded-2xl border border-white/10 bg-white/5 p-5 text-left backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-purple-500/40 hover:bg-white/[0.07]"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="line-clamp-2 text-base font-semibold text-white">
          {discussion.topic}
        </h3>
        <span
          data-testid="status-badge"
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] ${meta.badge}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
      </div>

      {discussion.summary ? (
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-gray-400">
          {discussion.summary}
        </p>
      ) : (
        <p className="mt-2 text-sm text-gray-600">尚无总结</p>
      )}

      <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
        <span>{discussion.expertCount} 位专家</span>
        <span>{formatTime(discussion.createdAt)}</span>
      </div>

      <span className="mt-3 text-xs font-medium text-purple-400 opacity-0 transition-opacity group-hover:opacity-100">
        进入演播厅 →
      </span>
    </button>
  );
}

export default function HomePage() {
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    discussionApi
      .list()
      .then((list) => {
        if (alive) setDiscussions(list);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : '加载讨论列表失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <header className="mb-16 text-center">
          <h1 className="mb-4 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-5xl font-bold text-transparent">
            AI Panel Studio
          </h1>
          <p className="text-xl text-gray-300">
            一键召唤虚拟智囊团，围绕任意议题展开深度圆桌讨论
          </p>
        </header>

        <div className="mb-12 text-center">
          <Link
            to="/create"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-8 py-4 text-lg font-semibold shadow-lg transition-all hover:scale-105 hover:from-purple-500 hover:to-pink-500 hover:shadow-purple-500/25"
          >
            <span>＋</span>
            发起新讨论
          </Link>
        </div>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-2xl font-semibold">全部讨论</h2>
            {!loading && !error && (
              <span className="text-sm text-gray-500">{discussions.length} 场</span>
            )}
          </div>

          {loading && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-44 animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]"
                />
              ))}
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-rose-300">加载失败：{error}</p>
              <button
                onClick={() => setReloadKey((key) => key + 1)}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 hover:text-white"
              >
                重试
              </button>
            </div>
          )}

          {!loading && !error && discussions.length === 0 && (
            <div className="py-16 text-center text-gray-400">
              <p className="mb-2 text-lg">还没有讨论</p>
              <p className="text-sm">
                点击上方「发起新讨论」，输入话题后开始你的第一场 AI 圆桌讨论
              </p>
            </div>
          )}

          {!loading && !error && discussions.length > 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {discussions.map((discussion) => (
                <DiscussionCard key={discussion.id} discussion={discussion} />
              ))}
            </div>
          )}
        </section>

        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
          {[
            { title: '多视角碰撞', desc: '不同立场的 AI 专家实时对话，打破单一视角盲区' },
            { title: '沉浸式演播厅', desc: '主持人串场 + 专家举手发言，像看真实圆桌讨论' },
            { title: '共识自动提炼', desc: '讨论中实时提炼共识与分歧，最终自动生成总结' },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm"
            >
              <h3 className="mb-2 text-lg font-semibold">{item.title}</h3>
              <p className="text-sm text-gray-400">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
