import { useStudioStore } from '../../store/studioStore';

export function ConsensusPanel() {
  const consensus = useStudioStore((s) => s.consensus);

  if (consensus.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-gray-500">
        讨论进行中实时更新
      </div>
    );
  }

  const consensuses = consensus.filter((item) => item.type === 'consensus');
  const divergences = consensus.filter((item) => item.type === 'divergence');

  return (
    <div className="space-y-4">
      <Group title="共识" tone="emerald" items={consensuses} />
      <Group title="分歧" tone="rose" items={divergences} />
    </div>
  );
}

function Group({
  title,
  tone,
  items,
}: {
  title: string;
  tone: 'emerald' | 'rose';
  items: { id: string; content: string; sourceMessageIds?: string[] }[];
}) {
  if (items.length === 0) return null;

  const toneClass =
    tone === 'emerald'
      ? 'border-emerald-400/50 text-emerald-300'
      : 'border-rose-400/50 text-rose-300';

  return (
    <section>
      <h3 className={`mb-2 flex items-center gap-2 text-xs font-medium ${toneClass.split(' ')[1]}`}>
        <span className={`h-2 w-2 rounded-full ${tone === 'emerald' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
        {title}
        <span className="text-gray-500">{items.length}</span>
      </h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className={`rounded-r-lg border-l-2 bg-white/[0.03] px-3 py-2 ${toneClass.split(' ')[0]}`}
          >
            <p className="text-xs leading-relaxed text-gray-300">{item.content}</p>
            {item.sourceMessageIds && item.sourceMessageIds.length > 0 && (
              <p className="mt-1 text-[10px] text-gray-500">
                来源 {item.sourceMessageIds.length} 条发言
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
