import { useParams, useNavigate } from 'react-router-dom';

export default function StudioPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* 顶部栏 */}
      <header className="border-b border-white/10 px-6 py-4 shrink-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="text-gray-400 hover:text-white"
            >
              ←
            </button>
            <div>
              <h1 className="text-lg font-semibold">讨论话题（待接入）</h1>
              <p className="text-xs text-gray-500">ID: {id}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            <span className="text-sm text-gray-400">等待开始</span>
          </div>
        </div>
      </header>

      {/* 主内容区 */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0">
        {/* 左侧 - Transcript 发言记录 */}
        <div className="lg:col-span-2 bg-slate-900/50 rounded-2xl border border-white/5 p-6 flex flex-col min-h-0">
          <h2 className="text-base font-semibold mb-4 shrink-0">发言记录</h2>
          <div className="flex-1 overflow-y-auto space-y-4">
            <div className="text-center text-gray-500 py-12 text-sm">
              <p className="mb-2">🎬 演播厅已就绪</p>
              <p>确认嘉宾阵容后，讨论即将开始...</p>
            </div>
          </div>
        </div>

        {/* 右侧 - 嘉宾 + 共识 */}
        <div className="flex flex-col gap-6 min-h-0">
          {/* 嘉宾状态小窗 */}
          <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-6 shrink-0">
            <h2 className="text-base font-semibold mb-4">嘉宾席</h2>
            <div className="space-y-3">
              <div className="text-center text-gray-500 py-4 text-sm">
                等待嘉宾入场...
              </div>
            </div>
          </div>

          {/* 共识与分歧 */}
          <div className="bg-slate-900/50 rounded-2xl border border-white/5 p-6 flex-1 flex flex-col min-h-0">
            <h2 className="text-base font-semibold mb-4 shrink-0">共识与分歧</h2>
            <div className="flex-1 overflow-y-auto">
              <div className="text-center text-gray-500 py-4 text-sm">
                讨论进行中实时更新
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
