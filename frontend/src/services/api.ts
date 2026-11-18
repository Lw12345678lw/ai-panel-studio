import type { Discussion, PanelMember, Message, ConsensusItem } from '../types';

const API_BASE = '/api';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

export const discussionApi = {
  list: () => request<Discussion[]>('/discussions'),
  get: (id: string) => request<Discussion>(`/discussions/${id}`),
  create: (topic: string, expertCount: number) =>
    request<Discussion>('/discussions', {
      method: 'POST',
      body: JSON.stringify({ topic, expertCount }),
    }),
  generatePanel: (id: string) =>
    request<PanelMember[]>(`/discussions/${id}/generate-panel`, {
      method: 'POST',
    }),
  start: (id: string) =>
    request<Discussion>(`/discussions/${id}/start`, {
      method: 'POST',
    }),
  getPanel: (id: string) =>
    request<PanelMember[]>(`/discussions/${id}/panel`),
  getMessages: (id: string) =>
    request<Message[]>(`/discussions/${id}/messages`),
  getConsensus: (id: string) =>
    request<ConsensusItem[]>(`/discussions/${id}/consensus`),
};

export function createEventStream(discussionId: string): EventSource {
  return new EventSource(`${API_BASE}/discussions/${discussionId}/stream`);
}
