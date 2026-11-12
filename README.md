# dsh-cn30 · 社媒雷达 CN30

DeepSeek Harness（dsh）插件：**中国社媒话题研究**。从小红书、抖音、公众号三大平台搜索近 30 天真实讨论（标题/作者/互动数据/链接），agent 跨平台对比分析舆情趋势、撰写研究报告内嵌交互式 HTML，侧栏看板同步呈现。

移植自 [redfox-data/redfox-community](https://github.com/redfox-data/redfox-community) 的 `skills/cn-last30days`（Python 引擎全量重写为 Node 原生，**零 Python 依赖**；输出 LAW 规则与平台信号口径完整保留）。

## 三种平台信号

| 平台 | 内容特征 | 关键指标 | 解读 |
|------|---------|---------|------|
| 📕 小红书 | 种草体验、教程攻略 | 收藏/点赞比 | 高 = 种草信号 |
| 🎵 抖音 | 热点追评、情绪传播 | 分享数 | 高 = 传播力 |
| 📖 公众号 | 行业深度、数据报告 | 阅读量/转发 | 高 = 关注度/认同 |

## 工作流

```
cn30_search(action="search", keyword="相关词1,相关词2")   ← 同步秒回（1-2 次 HTTP）
  → list 分平台深挖条目（可选，带摘要）
  → agent 按 cn-last30days 技能综合分析（按话题叙事，跨平台交叉验证）
  → cn30_search(action="report", reportMd=…)               ← 研究报告内嵌 HTML
  → 按 LAW 规则输出：徽章 → 数据速览（三平台 TOP5 表格）→ 我的发现 → 核心发现 → 页脚
```

- 关键词过模糊（"工具"）agent 会先追问；相关词合并一次查询（每平台最多 5 词）
- 时间范围 1-30 天可调（默认 30；看近期趋势设 7）
- 对比类查询（"A vs B"）有专门的输出模板

## 面板（侧栏「社媒雷达 CN30」）

- **概览**：话题搜索表单（关键词/平台勾选/条数/天数）+ 搜索历史卡片；「去对话研究」开新对话
- **结果页**：三平台统计格（条数+点赞合计）+ 平台 Tab 卡片列表（真实数据：标题/作者/粉丝/互动/摘要/原文链接）+「去对话写研究报告」+「打开完整报告」；**接口/网络/积分失败时逐平台标注错误**（概览卡片也会标「N 个平台失败」），不会把失败当成"没搜到"
- **设置**：RedFox API Key（本机存储）、代理、接口地址

HTML 报告：hero + 平台统计卡 + 研究报告区（agent 撰写的 Markdown 内嵌）+ 三平台 Tab 卡片列表，单页交互式。

## 配置

**RedFox API Key**（必需，`ak_` 开头）：[红狐 hub](https://redfox.hk/settings/api-keys?source=github) 获取。优先级：插件配置 `apiKey` > 面板「设置」页 > 环境变量 `REDFOX_API_KEY` / `X_API_KEY`。

> ✅ 2026-11-12 实测：cn30 使用的多平台作品搜索接口**免费积分可用**（与六个 AI 搜索接口的付费墙不同），免费 Key 即可搜索。积分不足时插件会明确提示（3201 → 充值地址）。

## 开发

```bash
npm i
npm run build      # client.js → dist/client.js
npm test           # 14 个单测（数量解析/三平台归一化/引擎翻页/报告生成/工具全链路）
npm run smoke      # 离线冒烟：本地假 RedFox 服务器全链路（工具 + 面板 API）
npm run live       # 真实 API 冒烟：node scripts/live.mjs <关键词> ak_xxx（三平台 20 条/平台）
npm run dev        # 面板独立预览：DSH_HOME=<目录> node scripts/devserver.mjs 5180
```

数据落在 `$DSH_HOME/cn30/`：`settings.json` + `searches/<id>/`（meta/原始条目/研究报告 md/HTML 报告），原子写（tmp+rename）。

## 结构

```
src/host.js            cn30_search 工具（search/list/report/history）+ 装配
src/systemPrompt.js    工作流硬规则注入
lib/redfox.js          传输层（双 header、3108 退避、3201/3203 友好翻译、代理隧道）
lib/engine.js          同步搜索（统一接口 + 抖音广域库翻页、去重、日期范围）
lib/normalize.js       三平台归一化（work* 前缀与 id/title 两代字段兼容、w/万/亿 数量解析）
lib/report.js          HTML 报告 + md→html（研究报告内嵌）
lib/store.js           searches/<id> 持久化 + 设置
lib/api.js             /cn30 面板路由（含 /analysis-md 通道）
client.js / lab/       浏览器半边（侧栏入口 + iframe 面板，明暗跟随 dsh 主题）
skills/cn-last30days/  研究方法论技能（LAW 输出规则 + cn30-metrics 参考）
```

## License

MIT（本插件代码）。方法论与 API 用例参考 redfox-data/redfox-community skills/cn-last30days（上游 MIT）；RedFox API 使用受其服务条款约束。
