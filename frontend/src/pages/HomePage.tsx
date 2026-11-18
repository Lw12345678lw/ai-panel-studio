import { Link } from 'react-router-dom';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      <div className="max-w-6xl mx-auto px-6 py-12">
        {/* 头部 */}
        <header className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            AI Panel Studio
          </h1>
          <p className="text-xl text-gray-300">
            一键召唤虚拟智囊团，围绕任意议题展开深度圆桌讨论
          </p>
        </header>

        {/* 新建讨论按钮 */}
        <div className="text-center mb-12">
          <Link
            to="/create"
            className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-xl text-lg font-semibold transition-all shadow-lg hover:shadow-purple-500/25 hover:scale-105"
          >
            <span>＋</span>
            发起新讨论
          </Link>
        </div>

        {/* 讨论列表占位 */}
        <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-8 border border-white/10">
          <h2 className="text-2xl font-semibold mb-6">进行中的讨论</h2>
          <div className="text-center py-12 text-gray-400">
            <p className="text-lg mb-2">还没有讨论</p>
            <p className="text-sm">点击上方按钮发起你的第一场 AI 圆桌讨论</p>
          </div>
        </div>

        {/* 功能介绍 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
          {[
            { title: '多视角碰撞', desc: '不同立场的 AI 专家实时对话，打破单一视角盲区' },
            { title: '沉浸式演播厅', desc: '主持人串场 + 专家举手发言，像看真实圆桌讨论' },
            { title: '共识自动提炼', desc: '讨论中实时提炼共识与分歧，最终自动生成总结' },
          ].map((item, i) => (
            <div key={i} className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10">
              <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
              <p className="text-gray-400 text-sm">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
