# API 文档

## 基础信息

- Base URL: `/api`
- 数据格式: JSON
- 实时通信: SSE (Server-Sent Events)

---

## 讨论相关接口

### 1. 获取讨论列表

```
GET /discussions
```

**响应示例：**
```json
[
  {
    "id": "uuid",
    "topic": "AI 对就业市场的影响",
    "status": "ongoing",
    "expertCount": 4,
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
]
```

### 2. 获取讨论详情

```
GET /discussions/:id
```

### 3. 创建讨论

```
POST /discussions
Content-Type: application/json

{
  "topic": "讨论话题",
  "expertCount": 4
}
```

**响应：** Discussion 对象

### 4. 生成嘉宾阵容

```
POST /discussions/:id/generate-panel
```

调用大模型生成主持人 + 专家阵容。

**响应：** PanelMember[] 数组（不含运行时状态；发言状态经 SSE `status_update` 事件实时推送）

### 5. 开始讨论

```
POST /discussions/:id/start
```

用户确认阵容后，开始演播厅讨论。

**响应：** Discussion 对象（status 更新为 ongoing）

### 6. 获取嘉宾列表

```
GET /discussions/:id/panel
```

**响应：** PanelMember[] 数组（不含运行时状态；发言状态经 SSE `status_update` 事件实时推送）

### 7. 获取发言记录

```
GET /discussions/:id/messages
```

**响应：** Message[] 数组（含关联的 panelMember 信息；每条含 `roundId` 指向所属轮次，可空）

### 8. 获取共识与分歧

```
GET /discussions/:id/consensus
```

**响应：** ConsensusItem[] 数组（含 `sourceMessageIds` 溯源字段，指向来源发言）

### 9. 获取轮次列表

```
GET /discussions/:id/rounds
```

**响应：** Round[] 数组（按 seq 升序，含 question、status）

---

## SSE 实时事件流

```
GET /discussions/:id/stream
Content-Type: text/event-stream
```

### 事件类型

| 事件类型 | 说明 | data 内容 |
|---------|------|----------|
| `panel_generating` | 嘉宾生成中 | `{ message: string }` |
| `panel_generated` | 嘉宾生成完成 | `{ panel: PanelMember[] }` |
| `discussion_started` | 讨论开始 | `{ discussion: Discussion }` |
| `speech_start` | 某人开始发言 | `{ panelMemberId: string, panelMember: PanelMember }` |
| `speech_chunk` | 发言内容片段 | `{ panelMemberId: string, content: string }` |
| `speech_end` | 发言结束 | `{ panelMemberId: string, message: Message }` |
| `status_update` | 嘉宾状态变更 | `{ panelMemberId: string, status: string }` |
| `consensus_update` | 共识/分歧更新 | `{ items: ConsensusItem[] }` |
| `discussion_summary` | 最终总结 | `{ summary: string }` |
| `discussion_finished` | 讨论结束 | `{ discussion: Discussion }` |
| `error` | 错误 | `{ message: string }` |

### 事件格式

```
event: speech_chunk
data: {"panelMemberId": "xxx", "content": "我认为..."}
```
