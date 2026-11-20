import { useStudioStore } from '../../store/studioStore';

export function StudioStatusPill() {
  const phase = useStudioStore((s) => s.phase);
  const connection = useStudioStore((s) => s.connection);

  const view = describe(phase, connection);

  return (
    <div className="flex items-center gap-2">
      <span
        className={`h-2 w-2 rounded-full ${view.dot} ${view.pulse ? 'animate-pulse' : ''}`}
      />
      <span className={`text-sm ${view.text}`}>{view.label}</span>
    </div>
  );
}

function describe(
  phase: ReturnType<typeof useStudioStore.getState>['phase'],
  connection: ReturnType<typeof useStudioStore.getState>['connection'],
): { label: string; dot: string; text: string; pulse: boolean } {
  if (phase === 'loading') {
    return { label: '加载中…', dot: 'bg-gray-400', text: 'text-gray-400', pulse: true };
  }
  if (phase === 'error') {
    return { label: '加载失败', dot: 'bg-rose-500', text: 'text-rose-300', pulse: false };
  }
  if (phase === 'finished') {
    return { label: '讨论已结束', dot: 'bg-purple-400', text: 'text-purple-300', pulse: false };
  }
  if (phase === 'waiting') {
    return { label: '等待开始', dot: 'bg-amber-400', text: 'text-amber-300', pulse: true };
  }

  // ongoing
  switch (connection) {
    case 'open':
      return { label: '直播中', dot: 'bg-emerald-500', text: 'text-emerald-300', pulse: true };
    case 'connecting':
      return { label: '连接中…', dot: 'bg-gray-400', text: 'text-gray-400', pulse: true };
    case 'reconnecting':
      return { label: '重连中…', dot: 'bg-amber-400', text: 'text-amber-300', pulse: true };
    case 'closed':
      return { label: '连接已断开', dot: 'bg-rose-500', text: 'text-rose-300', pulse: false };
    default:
      return { label: '讨论进行中', dot: 'bg-emerald-500', text: 'text-emerald-300', pulse: true };
  }
}
