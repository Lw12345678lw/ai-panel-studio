import { useEffect, useMemo, useRef } from 'react';
import type { Message, PanelMember } from '../../types';
import { useTypewriter } from '../../hooks/useTypewriter';
import { useStudioStore } from '../../store/studioStore';

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function MessageBubble({ message, member }: { message: Message; member?: PanelMember }) {
  const name = member?.name ?? '未知';
  const color = member?.color ?? '#64748b';
  const isHost = member?.role === 'host';

  return (
    <div data-testid="transcript-message" className="flex gap-3">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
        style={{ backgroundColor: color }}
      >
        {name.slice(0, 1)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-sm font-medium text-white">{name}</span>
          {isHost && (
            <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-300">
              主持
            </span>
          )}
          <span className="text-[11px] text-gray-500">{formatTime(message.createdAt)}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">
          {message.content}
        </p>
      </div>
    </div>
  );
}

function StreamingBubble({ member }: { member: PanelMember | null }) {
  const text = useStudioStore((s) =>
    s.activeSpeakerId ? (s.streamingText[s.activeSpeakerId] ?? '') : '',
  );
  const typed = useTypewriter(text);
  const speaking = typed.length < text.length;

  const name = member?.name ?? '嘉宾';
  const color = member?.color ?? '#64748b';

  return (
    <div className="flex gap-3">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
        style={{ backgroundColor: color }}
      >
        {name.slice(0, 1)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-sm font-medium text-white">{name}</span>
          <span className="flex items-center gap-1 text-[11px] text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            正在发言
          </span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">
          {typed}
          {speaking && <span className="typewriter-cursor ml-0.5 text-emerald-300">▍</span>}
          {!text && (
            <span className="inline-flex items-center gap-1 text-gray-500">
              <i className="h-1 w-1 animate-bounce rounded-full bg-gray-500" />
              <i
                className="h-1 w-1 animate-bounce rounded-full bg-gray-500"
                style={{ animationDelay: '0.15s' }}
              />
              <i
                className="h-1 w-1 animate-bounce rounded-full bg-gray-500"
                style={{ animationDelay: '0.3s' }}
              />
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

export function TranscriptPanel() {
  const transcript = useStudioStore((s) => s.transcript);
  const members = useStudioStore((s) => s.members);
  const activeSpeakerId = useStudioStore((s) => s.activeSpeakerId);
  const phase = useStudioStore((s) => s.phase);
  const memberCount = useStudioStore((s) => s.members.length);
  const streamingLength = useStudioStore((s) =>
    s.activeSpeakerId ? (s.streamingText[s.activeSpeakerId]?.length ?? 0) : 0,
  );

  const memberById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );
  const activeSpeaker = activeSpeakerId ? (memberById.get(activeSpeakerId) ?? null) : null;

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [transcript.length, streamingLength, activeSpeakerId]);

  if (transcript.length === 0 && !activeSpeakerId) {
    const hint =
      memberCount === 0
        ? phase === 'generating'
          ? '正在生成嘉宾阵容，请稍候…'
          : '尚未生成嘉宾阵容'
        : phase === 'waiting'
          ? '点击「开始讨论」，嘉宾即将入场'
          : '等待讨论开始…';

    return (
      <div className="flex flex-1 items-center justify-center text-center text-sm text-gray-500">
        <div>
          <p className="mb-2">
            {memberCount === 0 && phase === 'generating' ? '⏳ 嘉宾生成中' : '🎬 演播厅已就绪'}
          </p>
          <p>{hint}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-5 overflow-y-auto pr-1" aria-live="polite">
      {transcript.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          member={memberById.get(message.panelMemberId)}
        />
      ))}
      {activeSpeaker && <StreamingBubble member={activeSpeaker} />}
      <div ref={bottomRef} />
    </div>
  );
}
