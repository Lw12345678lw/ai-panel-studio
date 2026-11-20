// useTypewriter.ts — 把持续增长的 target 逐字渲染，避免网络抖动造成的跳字。
import { useEffect, useRef, useState } from 'react';

interface TypewriterOptions {
  tickMs?: number;
  charsPerTick?: number;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useTypewriter(target: string, options: TypewriterOptions = {}): string {
  const { tickMs = 26, charsPerTick = 2 } = options;
  const reduced = prefersReducedMotion();
  const [displayed, setDisplayed] = useState('');
  const displayedRef = useRef('');

  useEffect(() => {
    if (reduced) {
      displayedRef.current = target;
      setDisplayed(target);
      return;
    }

    // 新一轮发言（target 不再是已显示内容的前缀）→ 从头开始
    if (!target.startsWith(displayedRef.current)) {
      displayedRef.current = '';
      setDisplayed('');
    }

    if (displayedRef.current.length >= target.length) return;

    const timer = setInterval(() => {
      const current = displayedRef.current;
      if (current.length >= target.length) {
        clearInterval(timer);
        return;
      }
      const next = target.slice(0, Math.min(target.length, current.length + charsPerTick));
      displayedRef.current = next;
      setDisplayed(next);
    }, tickMs);

    return () => clearInterval(timer);
  }, [target, tickMs, charsPerTick, reduced]);

  return reduced ? target : displayed;
}
