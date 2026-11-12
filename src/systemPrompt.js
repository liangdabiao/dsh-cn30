// 系统提示注入：社媒雷达 CN30 工作流硬规则（方法论与 LAW 输出规则在 cn-last30days 技能里）。
export const SYSTEM_RULES = `## 社媒雷达 CN30（cn30）

用户要「研究某话题在国内社媒的讨论 / 舆情趋势 / 跨平台对比 / 小红书抖音公众号相关内容」时：

**流程**：cn30_search(action="search", keyword="话题[,子话题]")（同步秒回）→ list 需要时补读条目 → 按 cn-last30days 技能综合分析并撰写研究报告 → cn30_search(action="report", reportMd=…) 内嵌生成 HTML → 按 LAW 规则向用户输出（数据速览 → 我的发现 → 核心发现 → 页脚）。

**硬规则**：关键词过模糊（"工具"、"方法"）先请用户具体化；相关词合并一次查询（逗号分隔，每平台最多 5 词）；结论按话题综合而非按平台罗列；跨平台交叉验证的结论置信度最高；引用一律内联 Markdown 链接（优先作品链接）；不用破折号（用 " - "）；末尾逐字带上工具返回的页脚。搜索失败（积分不足/无数据）如实转述，不编造条目。`

export function systemSection() {
  return {
    name: 'cn30:workflow',
    order: 110,
    text: SYSTEM_RULES,
  }
}
