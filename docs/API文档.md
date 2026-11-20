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

> **同步接口**：一次性调用、一次性返回，耗时约 10~25 秒，前端需 loading 态（动画 + 已等待秒数）。此阶段无真实事件流，不使用 SSE（SSE 仅用于演播厅的持续事件流）。

**响应：** PanelMember[] 数组（不含运行时状态；发言状态经 SSE `status_update` 事件实时推送）

### 5. 开始讨论

```
POST /discussions/:id/start
```

用户确认阵容后，异步拉起讨论编排器。接口立即返回，讨论在后台继续运行，实时进度通过 SSE
`GET /discussions/:id/stream` 推送。

**前置条件：** 已生成嘉宾阵容（1 位 host + 至少 2 位 expert）。

**响应：** `200` + Discussion 对象（status 更新为 `ongoing`）

| 状态码 | 场景 | 响应体 |
|--------|------|--------|
| 404 | 讨论不存在 | `{ "error": "讨论不存在" }` |
| 409 | 尚未生成阵容 | `{ "error": "请先生成嘉宾阵容" }` |
| 409 | 已开始 / 已结束 / 正在运行 | `{ "error": "讨论已开始或已结束" }` |

> 并发安全：服务端用 `UPDATE ... WHERE id=? AND status='waiting'` 原子抢占状态，
> 重复 start 只有一个请求成功；内存 `activeRuns` 仅作第二道保险。

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
Accept: text/event-stream
```

- 连接可以**早于或晚于** `start` 建立；晚到会自动回放已发生的事件。
- 讨论结束后服务端**不主动断连**，前端收到 `discussion_finished` 后应主动 `EventSource.close()`。
- 支持同一讨论的多个客户端同时订阅。

### 响应头与连接参数

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

连接建立后立即发送 `retry: 3000`，表示断线后浏览器 3 秒重连。

### 帧格式

```
id: 42
event: speech_chunk
data: {"panelMemberId":"xxx","content":"我认为"}
```

- `id:` 为**讨论内自增**序号（从 1 开始），用于断线续传。
- 每 15 秒发送一条注释帧保活：`: ping`（EventSource 不会触发事件回调）。
- `data:` 为单行 JSON，字段结构与下表一致。

### 断线重连与回放

| 场景 | 服务端行为 |
|------|-----------|
| 新连接，不带 `Last-Event-ID` | 回放该讨论的**全部 history**（讨论已结束时也能补全全过程） |
| 重连，带 `Last-Event-ID: N` | 只回放 `id > N` 的事件 |
| 讨论已结束且 history 已清理（服务重启） | 合成一条 `discussion_finished` 后保持连接 |

- history **只保存非 `speech_chunk` 事件**（`speech_end` 已含完整 message），上限 500 条。
- `discussion_finished` 后 history 保留 15 分钟，随后清理。

### 事件类型

| 事件类型 | 说明 | data 内容 |
|---------|------|----------|
| `panel_generating` | 嘉宾生成中（预留，当前同步接口不发送） | `{ message: string }` |
| `panel_generated` | 嘉宾生成完成（预留） | `{ panel: PanelMember[] }` |
| `discussion_started` | 讨论开始 | `{ discussion: Discussion }` |
| `speech_start` | 某人开始发言 | `{ panelMemberId: string, panelMember: PanelMember }` |
| `speech_chunk` | 发言内容片段 | `{ panelMemberId: string, content: string }` |
| `speech_end` | 发言结束 | `{ panelMemberId: string, message: Message }` |
| `status_update` | 嘉宾状态变更 | `{ panelMemberId: string, status: 'idle' \| 'preparing' \| 'speaking' }` |
| `consensus_update` | 共识/分歧更新（每轮一次） | `{ items: Array<{ id, type, content, sourceMessageIds: string[] }> }` |
| `discussion_summary` | 最终总结 | `{ summary: string }` |
| `discussion_finished` | 讨论结束 | `{ discussion: Discussion }`（从 DB 重读，`status='finished'`） |
| `error` | 错误 | `{ message: string }` |

### 正常事件时序

```
discussion_started
  → status_update(preparing) → status_update(speaking) → speech_start
  → speech_chunk × N → status_update(idle) → speech_end
  →（每轮结束）consensus_update
  → discussion_summary → discussion_finished
```

异常时：`error` → `discussion_finished`（DB 状态同样收敛为 `finished`）。

### 状态码

| 状态码 | 场景 |
|--------|------|
| 200 | 进入 SSE 长连接 |
| 404 | 讨论不存在（`application/json`，不进入 SSE） |
