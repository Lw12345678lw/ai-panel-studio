import type { PanelMember, PanelMemberStatus } from '../../types';
import { useStudioStore } from '../../store/studioStore';

const STATUS_TEXT: Record<PanelMemberStatus, { label: string; text: string }> = {
  idle: { label: '静听', text: 'text-gray-500' },
  preparing: { label: '准备中', text: 'text-amber-300' },
  speaking: { label: '发言中', text: 'text-white' },
};

export function PanelSeat({ member }: { member: PanelMember }) {
  const status = useStudioStore((s) => s.runtimeStatus[member.id] ?? 'idle');
  const text = STATUS_TEXT[status];

  return (
    <div
      className={`rounded-2xl border border-white/5 bg-slate-900/60 p-4 transition-all duration-300 ${
        status === 'speaking' ? 'scale-[1.02]' : ''
      } ${status === 'preparing' ? 'animate-pulse' : ''}`}
      style={
        status === 'speaking'
          ? { boxShadow: `0 0 0 2px ${member.color}, 0 10px 30px -10px ${member.color}` }
          : undefined
      }
      aria-label={`${member.name}，${text.label}`}
    >
      <div className="flex items-center gap-3">
        <div
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-semibold text-white"
          style={{ backgroundColor: member.color }}
        >
          {member.name.slice(0, 1)}
          {status === 'speaking' && (
            <span className="absolute -bottom-1 -right-1 flex h-4 items-end gap-[2px] rounded-full bg-slate-950/90 px-1 py-0.5">
              <i className="eq-bar h-2 w-[2px] rounded-full bg-white" />
              <i className="eq-bar h-3 w-[2px] rounded-full bg-white" style={{ animationDelay: '0.15s' }} />
              <i className="eq-bar h-2 w-[2px] rounded-full bg-white" style={{ animationDelay: '0.3s' }} />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-white">{member.name}</p>
            {member.role === 'host' && (
              <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-300">
                主持
              </span>
            )}
          </div>
          <p className="truncate text-xs text-gray-500">{member.title}</p>
        </div>

        <span className={`flex shrink-0 items-center gap-1.5 text-xs ${text.text}`}>
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status === 'preparing' ? 'bg-amber-400' : status === 'idle' ? 'bg-gray-600' : ''
            }`}
            style={status === 'speaking' ? { backgroundColor: member.color } : undefined}
          />
          {text.label}
        </span>
      </div>
    </div>
  );
}
