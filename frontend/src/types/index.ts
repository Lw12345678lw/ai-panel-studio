// 讨论状态
export type DiscussionStatus = 'waiting' | 'generating' | 'ongoing' | 'finished';

// 嘉宾角色
export type PanelRole = 'host' | 'expert';

// 嘉宾状态
export type PanelMemberStatus = 'idle' | 'preparing' | 'speaking';

// 发言类型
export type MessageType = 'speech' | 'internal' | 'summary';

// 共识类型
export type ConsensusType = 'consensus' | 'divergence';

// 讨论
export interface Discussion {
  id: string;
  topic: string;
  status: DiscussionStatus;
  expertCount: number;
  summary?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

// 嘉宾
export interface PanelMember {
  id: string;
  discussionId: string;
  name: string;
  role: PanelRole;
  title: string;
  position: string;
  stance: string;
  color: string;
  status: PanelMemberStatus;
  createdAt: string;
}

// 发言
export interface Message {
  id: string;
  discussionId: string;
  panelMemberId: string;
  content: string;
  type: MessageType;
  createdAt: string;
  panelMember?: PanelMember;
}

// 共识项
export interface ConsensusItem {
  id: string;
  discussionId: string;
  type: ConsensusType;
  content: string;
  createdAt: string;
  updatedAt: string;
}

// SSE 事件类型
export type SSEEventType =
  | 'panel_generating'
  | 'panel_generated'
  | 'discussion_started'
  | 'speech_start'
  | 'speech_chunk'
  | 'speech_end'
  | 'status_update'
  | 'consensus_update'
  | 'discussion_summary'
  | 'discussion_finished'
  | 'error';

export interface SSEEvent {
  type: SSEEventType;
  data: any;
}
