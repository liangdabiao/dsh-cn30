# 社媒雷达 CN30（cn-last30days）指标与口径参考

## 数据源接口

| 平台 | 接口 | 说明 |
|------|------|------|
| 小红书 + 公众号 | POST /story/api/multiPlatform/workSearch | 统一多平台接口，一次返回 `data.xhsResult[]` + `data.gzhResult[]`（可能是 dict.articles 包装） |
| 抖音 | POST /story/api/dy/data/searchWork | 广域库接口，`data.list[]`，每页 ≤50 条需翻页取满 |

公共参数：`keyword / source / startDate / endDate`（抖音另加 `pageNum / pageSize`）。日期格式 `YYYY-MM-DD`。

## 错误码

| 码 | 含义 | 处理 |
|----|------|------|
| 200 / 2000 | 成功 | - |
| 3108 | 限频 | 退避 5s/10s/15s 重试（最多 3 次） |
| 3201 | 积分不足 | 不重试，提示充值 https://redfox.hk/dashboard/recharge |
| 3203 | 接口转付费 | 不重试，提示充值 |
| 401/403 | 鉴权失败 | 检查 Key |

## 数量口径

- `parse_count`：兼容 `1.2w` / `5000+` / `3万` / `2亿` / 纯数字
- `fuzzy_count`（展示用模糊化）：≤0 显示 `--`；<5000 原值；5000-9999 显示 `5000+`；≥10000 显示 `Nw+`（向下取整万）

## 平台条目字段映射（归一化后）

统一条目：`id / platform / title / desc(≤500) / url / author / author_link / author_fans / published_at / engagement / engagement_display / cover / scores`

- **小红书**：互动 = 点赞/评论/收藏/分享/总互动；链接兜底 `https://www.xiaohongshu.com/explore/{noteId}(?xsec_token=…)`；作者主页 `…/user/profile/{authorId}`
- **抖音**：互动 = 点赞/评论/收藏/分享；作者主页按 `authorSecUid`（兜底 authorUid）拼 `…/user/{id}`；**无粉丝数**（显示 --）
- **公众号**：互动 = 阅读(clicksCount)/点赞/在看/收藏/分享/评论；无作者主页链接；**不展示粉丝字段**

去重主键（按优先级）：`workUuid → uuid → videoId → workId → id → noteId`。

## 平台信号解读

- 小红书：收藏/点赞比高 = 种草信号
- 抖音：分享数 = 传播力
- 公众号：阅读量 = 关注度，分享 = 认同

## 数据局限

1. 互动数据为入库快照，实时可能增长
2. 小红书受风控限制部分链接无法直接跳转（复制标题去站内搜索）
3. 单次 3 平台 × 50 条 = 150 条样本，统计意义有限，适合趋势洞察而非精确排名
