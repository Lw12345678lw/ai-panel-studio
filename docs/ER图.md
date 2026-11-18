# 数据模型与 ER 图

## ER 图

```mermaid
erDiagram
    Discussion ||--o{ PanelMember : has
    Discussion ||--o{ Message : has
    Discussion ||--o{ ConsensusItem : has
    PanelMember ||--o{ Message : speaks

    Discussion {
        string id PK
        string topic
        string status
        int expertCount
        string summary
        datetime createdAt
        datetime updatedAt
        datetime finishedAt
    }

    PanelMember {
        string id PK
        string discussionId FK
        string name
        string role
        string title
        string position
        string stance
        string color
        string status
        datetime createdAt
    }

    Message {
        string id PK
        string discussionId FK
        string panelMemberId FK
        string content
        string type
        datetime createdAt
    }

    ConsensusItem {
        string id PK
        string discussionId FK
        string type
        string content
        datetime createdAt
        datetime updatedAt
    }
```

## 实体说明

### Discussion（讨论）
核心实体，代表一场完整的圆桌讨论。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | UUID 主键 |
| topic | String | 讨论话题 |
| status | String | 状态：waiting / generating / ongoing / finished |
| expertCount | Int | 专家人数（不含主持人） |
| summary | String? | 最终总结（讨论结束后生成） |
| createdAt | DateTime | 创建时间 |
| updatedAt | DateTime | 更新时间 |
| finishedAt | DateTime? | 结束时间 |

### PanelMember（嘉宾）
参与讨论的角色，包括主持人和专家。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | UUID 主键 |
| discussionId | String | 关联讨论 ID |
| name | String | 姓名 |
| role | String | 角色：host / expert |
| title | String | 头衔（如：主持人、资深经济学家） |
| position | String | 职位/机构 |
| stance | String | 立场描述 |
| color | String | 专属颜色（十六进制，如 #8B5CF6） |
| status | String | 状态：idle / preparing / speaking |
| createdAt | DateTime | 创建时间 |

### Message（发言）
讨论过程中的每一条发言记录。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | UUID 主键 |
| discussionId | String | 关联讨论 ID |
| panelMemberId | String | 发言人 ID |
| content | String | 发言内容 |
| type | String | 类型：speech / internal / summary |
| createdAt | DateTime | 发言时间 |

### ConsensusItem（共识与分歧）
从讨论中提炼的共识或分歧点。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | UUID 主键 |
| discussionId | String | 关联讨论 ID |
| type | String | 类型：consensus / divergence |
| content | String | 内容描述 |
| createdAt | DateTime | 创建时间 |
| updatedAt | DateTime | 更新时间 |
