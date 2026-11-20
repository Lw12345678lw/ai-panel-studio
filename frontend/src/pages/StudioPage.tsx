import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ConsensusPanel } from '../components/studio/ConsensusPanel';
import { PanelSeat } from '../components/studio/PanelSeat';
import { StudioStatusPill } from '../components/studio/StudioStatusPill';
import { TranscriptPanel } from '../components/studio/TranscriptPanel';
import { useDiscussionStream } from '../hooks/useDiscussionStream';
import { useStudioStore } from '../store/studioStore';

export default function StudioPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const load = useStudioStore((s) => s.load);
  const start = useStudioStore((s) => s.start);
  const generatePanel = useStudioStore((s) => s.generatePanel);
  const setError = useStudioStore((s) => s.setError);
  const phase = useStudioStore((s) => s.phase);
  const discussion = useStudioStore((s) => s.discussion);
  const members = useStudioStore((s) => s.members);
  const transcriptCount = useStudioStore((s) => s.transcript.length);
  const summary = useStudioStore((s) => s.summary);
  const error = useStudioStore((s) => s.error);
  const activeSpeakerId = useStudioStore((s) => s.activeSpeakerId);

  const [starting, setStarting] = useState(false);
  const [generatingPanel, setGeneratingPanel] = useState(false);

  useEffect(() => {
    if (id) void load(id);
  }, [id, load]);

  // 讨论已 hydrate 且未结束时建连；start 之后 phase 变 ongoing，enabled 不变
  useDiscussionStream(id, !!id && (phase === 'waiting' || phase === 'ongoing'));

  const host = members.find((member) => member.role === 'host');
  const expertCount = members.filter((member) => member.role === 'expert').length;
  const hasPanel = !!host && expertCount >= 2;

  const handleStart = async () => {
    if (!hasPanel || starting) return;
    setStarting(true);
    await start();
    setStarting(false);
  };

  const handleGeneratePanel = async () => {
    if (generatingPanel) return;
    setGeneratingPanel(true);
    await generatePanel();
    setGeneratingPanel(false);
  };

  if (!id) return null;

  if (phase === 'idle' || phase === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-gray-400">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        <span className="ml-3 text-sm">正在进入演播厅…</span>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center text-white">
        <p className="text-lg font-semibold">加载失败</p>
        <p className="max-w-md text-sm text-gray-400">
          {error ?? '讨论不存在或网络异常'}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => void load(id)}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium hover:bg-purple-500"
          >
            重试
          </button>
          <button
            onClick={() => navigate('/')}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 hover:text-white"
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-white">
      <header className="shrink-0 border-b border-white/10 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="text-gray-400 hover:text-white"
              aria-label="返回首页"
            >
              ←
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold">
                {discussion?.topic ?? '讨论'}
              </h1>
              <p className="text-xs text-gray-500">
                {hasPanel ? `${expertCount} 位专家 · 主持人 ${host?.name}` : '嘉宾尚未入场'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <StudioStatusPill />
            {phase === 'waiting' && hasPanel && (
              <button
                onClick={handleStart}
                disabled={starting}
                title={starting ? '正在启动讨论，请稍候' : undefined}
                className="rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-4 py-2 text-sm font-medium transition-all hover:from-purple-500 hover:to-pink-500 disabled:cursor-not-allowed disabled:from-gray-700 disabled:to-gray-700"
              >
                {starting ? '启动中…' : '开始讨论 →'}
              </button>
            )}
          </div>
        </div>
      </header>

      {(phase === 'waiting' || phase === 'generating') && !hasPanel && (
        <div className="mx-auto mt-4 flex w-full max-w-7xl items-center justify-between gap-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <span>
            {phase === 'generating'
              ? '嘉宾阵容正在生成中，生成完成后即可开始讨论。'
              : '尚未生成嘉宾阵容，生成后「开始讨论」才可用。'}
          </span>
          <button
            onClick={handleGeneratePanel}
            disabled={generatingPanel}
            title={
              generatingPanel
                ? '正在生成嘉宾阵容，请稍候'
                : '调用 AI 生成 1 位主持人 + 4 位专家'
            }
            className="shrink-0 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generatingPanel
              ? '生成中…'
              : phase === 'generating'
                ? '重新生成阵容 →'
                : '去生成嘉宾 →'}
          </button>
        </div>
      )}

      {error && (
        <div className="mx-auto mt-4 flex w-full max-w-7xl items-center justify-between gap-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="shrink-0 text-rose-300 hover:text-white">
            关闭
          </button>
        </div>
      )}

      <div className="mx-auto grid min-h-0 w-full max-w-7xl flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-3">
        <section className="flex min-h-0 flex-col rounded-2xl border border-white/5 bg-slate-900/50 p-6 lg:col-span-2">
          <div className="mb-4 flex shrink-0 items-center justify-between">
            <h2 className="text-base font-semibold">发言记录</h2>
            <span className="text-xs text-gray-500">{transcriptCount} 条</span>
          </div>
          <TranscriptPanel />
        </section>

        <aside className="flex min-h-0 flex-col gap-6">
          <section className="shrink-0 rounded-2xl border border-white/5 bg-slate-900/50 p-6">
            <h2 className="mb-4 text-base font-semibold">嘉宾席</h2>
            {members.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-500">
                {phase === 'generating' ? '嘉宾阵容生成中…' : '等待嘉宾入场…'}
              </p>
            ) : (
              <div className="space-y-3">
                {members.map((member) => (
                  <PanelSeat key={member.id} member={member} />
                ))}
              </div>
            )}
            {discussion?.status === 'ongoing' && !activeSpeakerId && (
              <p className="mt-4 text-center text-[11px] leading-relaxed text-gray-500">
                本轮发言已结束，主持人正在组织下一轮…
              </p>
            )}
          </section>

          <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/5 bg-slate-900/50 p-6">
            <h2 className="mb-4 shrink-0 text-base font-semibold">共识与分歧</h2>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ConsensusPanel />
            </div>
          </section>
        </aside>
      </div>

      {phase === 'finished' && summary && (
        <div className="mx-auto w-full max-w-7xl px-6 pb-6">
          <section className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-6">
            <h2 className="mb-3 text-base font-semibold text-purple-200">最终总结</h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">
              {summary}
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
