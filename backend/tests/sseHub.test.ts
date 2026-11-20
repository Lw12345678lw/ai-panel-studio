// sseHub.test.ts — TDD：进程内 SSE 事件中枢的契约测试（实现尚未存在，预期全红）
// 纯内存，无网络、无 DB。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSseHub, type HubEvent } from '../src/services/sseHub';

function collect(hub: ReturnType<typeof createSseHub>, discussionId: string) {
  const events: HubEvent[] = [];
  const unsubscribe = hub.subscribe(discussionId, (e) => events.push(e));
  return { events, unsubscribe };
}

describe('sseHub', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('publish 向订阅者推送带自增 id 的事件', () => {
    const hub = createSseHub();
    const { events } = collect(hub, 'd1');

    hub.publish('d1', { type: 'speech_start', data: { panelMemberId: 'e1' } });
    hub.publish('d1', { type: 'speech_end', data: { panelMemberId: 'e1' } });

    expect(events).toEqual([
      { id: 1, type: 'speech_start', data: { panelMemberId: 'e1' } },
      { id: 2, type: 'speech_end', data: { panelMemberId: 'e1' } },
    ]);
  });

  it('id 按 discussionId 隔离，各自从 1 开始', () => {
    const hub = createSseHub();
    const a = collect(hub, 'd1');
    const b = collect(hub, 'd2');

    hub.publish('d1', { type: 'x', data: {} });
    hub.publish('d2', { type: 'x', data: {} });

    expect(a.events[0].id).toBe(1);
    expect(b.events[0].id).toBe(1);
  });

  it('退订后不再收到事件，订阅者计数即时释放', () => {
    const hub = createSseHub();
    const { events, unsubscribe } = collect(hub, 'd1');
    expect(hub.subscriberCount('d1')).toBe(1);

    unsubscribe();
    expect(hub.subscriberCount('d1')).toBe(0);

    hub.publish('d1', { type: 'x', data: {} });
    expect(events).toHaveLength(0);
  });

  it('history 不保存 speech_chunk，但保留 speech_end（重连不需要 chunk 回放）', () => {
    const hub = createSseHub();
    hub.publish('d1', { type: 'speech_start', data: { n: 1 } });
    hub.publish('d1', { type: 'speech_chunk', data: { n: 2 } });
    hub.publish('d1', { type: 'speech_end', data: { n: 3 } });

    expect(hub.replaySince('d1', 0).map((e) => e.type)).toEqual(['speech_start', 'speech_end']);
  });

  it('history 只保留最近 N 条（cap 截断）', () => {
    const hub = createSseHub({ historyLimit: 2 });
    for (let i = 1; i <= 4; i++) {
      hub.publish('d1', { type: 'status_update', data: { i } });
    }

    expect(hub.replaySince('d1', 0).map((e) => e.id)).toEqual([3, 4]);
    expect(hub.historySize('d1')).toBe(2);
  });

  it('replaySince 只返回 id 更大的事件', () => {
    const hub = createSseHub();
    hub.publish('d1', { type: 'a', data: {} }); // id 1
    hub.publish('d1', { type: 'b', data: {} }); // id 2
    hub.publish('d1', { type: 'c', data: {} }); // id 3

    expect(hub.replaySince('d1', 1).map((e) => e.id)).toEqual([2, 3]);
    expect(hub.replaySince('d1', 3)).toEqual([]);
  });

  it('没有订阅者时仍记录 history，供晚到连接回放', () => {
    const hub = createSseHub();
    hub.publish('d1', { type: 'discussion_started', data: {} });

    expect(hub.replaySince('d1', 0)).toHaveLength(1);
  });

  it('discussion_finished 后到达 TTL 自动清理 history 与订阅者', () => {
    vi.useFakeTimers();
    const hub = createSseHub({ finishedTtlMs: 1000 });
    collect(hub, 'd1');

    hub.publish('d1', { type: 'discussion_finished', data: {} });
    expect(hub.historySize('d1')).toBe(1);
    expect(hub.subscriberCount('d1')).toBe(1);

    vi.advanceTimersByTime(1000);

    expect(hub.historySize('d1')).toBe(0);
    expect(hub.subscriberCount('d1')).toBe(0);
    expect(hub.replaySince('d1', 0)).toEqual([]);
  });
});
