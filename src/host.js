// 社媒雷达 CN30 · Host 半边（cn30_search 原生工具 + cn-last30days 技能提供方 + 硬规则注入 + 面板数据面）。
// 搜索是同步接口（1-2 次 HTTP 秒回）；话题综合研究与「我的发现」输出由会话模型按技能完成，
// 研究报告写完 report 存档，内嵌进 HTML 报告。
import Schema from '@deepseek-ai/schemastery'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSkillProvider } from '../lib/skills.js'
import { systemSection } from './systemPrompt.js'
import { registerApi } from '../lib/api.js'
import { search, searchOpts } from '../lib/engine.js'
import { PLATFORM_KEYS, PLATFORMS } from '../lib/redfox.js'
import { formatReportHtml, mdToHtml } from '../lib/report.js'
import {
  saveSearch, getMeta, getRaw, listSearches, saveReportMd, getReportMd,
  saveReportHtml, readReportHtml, publicMeta, getSettings,
} from '../lib/store.js'

export const name = 'cn30' // = cordis.patch.yml 的 id

export const inject = ['tools', 'skills', 'systemPrompt', 'webServer', 'connection']

export const Config = Schema.object({
  injectRules: Schema.boolean().default(true).description('注入社媒雷达工作流到系统提示'),
  apiKey: Schema.string().default('').description('RedFox API Key（ak_ 开头；留空读面板设置或环境变量 REDFOX_API_KEY）'),
  proxyUrl: Schema.string().default('').description('HTTP(S) 代理（访问 redfox.hk 用），留空直连'),
})

function check(args, spec) {
  const problems = []
  for (const key of spec.required || []) {
    if (args?.[key] === undefined) problems.push(`缺少必填参数 ${key}`)
  }
  for (const [key, rule] of Object.entries(spec.properties || {})) {
    const value = args?.[key]
    if (value === undefined) continue
    if (rule.enum && !rule.enum.includes(value)) problems.push(`${key} 只能是 ${rule.enum.join(' / ')} 之一`)
  }
  for (const key of Object.keys(args || {})) {
    if (!spec.properties || !(key in spec.properties)) problems.push(`未知参数 ${key}`)
  }
  if (problems.length) throw new Error(`参数有误：${problems.join('；')}。`)
}

const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const num = (description, extra = {}) => ({ type: 'number', description, ...extra })
const text = (value) => [{ type: 'text', text: value }]

const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'summary'],
    properties: {
      ok: { type: 'boolean' },
      summary: { type: 'string', description: '给模型看的回执' },
      data: { type: 'string', description: '可选：条目列表/页脚/状态明细' },
      footer: { type: 'string', description: '可选：输出时需逐字附带的引擎页脚' },
    },
  },
  render: (_args, value) => text([value.summary, value.data, value.footer].filter(Boolean).join('\n\n')),
}

const result = (ok, summary, data = '', footer = '') => ({ ok, summary, data, footer })

const MAX_TEXT = 58000

function parsePlatforms(input) {
  if (!input) return null
  const keys = String(input).split(/[,，\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
  const bad = keys.filter((k) => !PLATFORM_KEYS.includes(k))
  if (bad.length) throw new Error(`未知平台：${bad.join(',')}（可选：${PLATFORM_KEYS.join(',')}）`)
  return keys.length ? keys : null
}

// runId 缺省解析为最新一次搜索
function resolveSearch(searchId) {
  if (searchId) {
    const meta = getMeta(searchId)
    if (!meta) throw new Error(`搜索记录不存在：${searchId}。用 history 查看已有记录。`)
    return meta
  }
  const [latest] = listSearches({ limit: 1 })
  if (!latest) throw new Error('还没有搜索记录。先 search（keyword 必填）。')
  return getMeta(latest.search_id)
}

// 条目 → 模型可读的紧凑行（标题/作者/互动/链接）
function renderItem(it, withDesc = false) {
  const url = it.url ? it.url : it.author_link || ''
  const base = `${it.id}｜《${it.title}》｜${it.author}｜${it.engagement_display}｜${String(it.published_at).slice(0, 10)}｜${url}`
  return withDesc && it.desc ? `${base}\n   ${it.desc.slice(0, 100)}` : base
}

// 引擎页脚（LAW 4：输出时逐字附带）
function buildFooter(data, searchId) {
  const parts = Object.entries(data.platforms).map(([p, r]) => `${PLATFORMS[p]?.label || p} ${r.total} 条${r.error ? '（' + r.error.slice(0, 40) + '）' : ''}`)
  return `🇨🇳 数据源：redfox.hk API（${parts.join(' / ')}）· ${data.date_range.from} ~ ${data.date_range.to} · 记录 ${searchId}`
}

// ---------------------------------------------------------------------------
// 工具：cn30_search —— search / list / report / history
// ---------------------------------------------------------------------------
export const cn30SearchTool = {
  name: 'cn30_search',
  description:
    '社媒雷达 CN30：从小红书/抖音/公众号三大平台搜索近 N 天（默认30，最多30）真实讨论，' +
    '返回标题/作者/互动数据/链接，跨平台对比舆情趋势。' +
    '流程：search 同步搜索（关键词过模糊先追问；相关词逗号合并，每平台最多5词）→ 按数据综合分析（按话题叙事，不按平台罗列）→ ' +
    'report 把研究报告 Markdown 内嵌生成 HTML 存档 → 按 cn-last30days 技能的 LAW 规则向用户输出（数据速览+我的发现+核心发现+页脚）。' +
    '需要 RedFox API Key（面板「设置」页或环境变量 REDFOX_API_KEY）。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: str('search 搜索；list 补读条目；report 研究报告存档+HTML；history 历史', {
        enum: ['search', 'list', 'report', 'history'],
      }),
      keyword: str('search：关键词，多词用英文逗号分隔（如 "AI视频工具,AI生成视频"）；相关词合并一次查'),
      platforms: str('search：平台逗号分隔 xhs,dy,gzh（默认全部三个，不建议缩减）'),
      count: num('search：每平台条数，默认 50'),
      days: num('search：时间范围天数，默认 30，最大 30；看近期趋势可设 7'),
      searchId: str('list/report/history 之外的定位：目标搜索记录 id；缺省=最新一次'),
      platform: str('list：只读某平台条目（xhs / dy / gzh）'),
      limit: num('list：最多返回条数，默认 30'),
      offset: num('list：跳过前 N 条'),
      withDesc: str('list：附带条目摘要（前100字）'),
      reportMd: str('report：研究报告 Markdown 全文（按 cn-last30days 技能撰写；引用用内联链接）'),
    },
  },
  output: OUTPUT,
  async execute(args, ctxConfig) {
    check(args, this.parameters)
    const cfg = ctxConfig || {}

    // ── search ───────────────────────────────────────────────────────────
    if (args.action === 'search') {
      if (!args.keyword || !String(args.keyword).trim()) throw new Error('search 需要 keyword。话题太模糊（如"工具"）时先请用户具体化。')
      const keyword = String(args.keyword).trim()
      const platforms = parsePlatforms(args.platforms)
      const count = Math.min(Math.max(Number(args.count) || 50, 1), 50)
      const days = Math.min(Math.max(Number(args.days) || 30, 1), 30)
      const opts = searchOpts({ settings: getSettings(), config: cfg })
      if (!opts.apiKey) {
        return result(false, '未配置 RedFox API Key。请用户到面板「社媒雷达 CN30 → 设置」填入，或在插件配置/环境变量 REDFOX_API_KEY 里配置（获取：https://redfox.hk/settings/api-keys?source=github）。')
      }
      const data = await search(keyword, { ...opts, platforms, count, days })
      data.count = count
      data.days = days
      const meta = saveSearch(data)
      const lines = [`搜索完成：${meta.total_items} 条（近 ${days} 天，${meta.date_range.from} ~ ${meta.date_range.to}）`]
      for (const [p, r] of Object.entries(data.platforms)) {
        lines.push(`${r.label}: ${r.total} 条${r.error ? ` ⚠️ ${r.error.slice(0, 80)}` : ''}`)
      }
      const totalsEmpty = meta.total_items === 0
      if (totalsEmpty) {
        // 先分清「接口全挂」和「真的没搜到」：前者是 Key/网络/接口问题，不该建议换关键词
        const plats = Object.values(data.platforms)
        const errs = plats.filter((p) => p.error)
        if (errs.length && errs.length >= plats.length) {
          return result(false,
            `搜索失败：${errs[0].error}（三个平台都没返回数据，通常是 Key 无效/积分不足/网络或代理不通）`,
            lines.join('\n'), buildFooter(data, meta.search_id))
        }
        return result(false,
          `三平台均无结果（关键词可能太生僻或平台收录有限）。建议换更口语化的关键词重试。`,
          lines.join('\n'), buildFooter(data, meta.search_id))
      }
      // 数据速览（LAW 7 用）+ 每平台 TOP 条目供分析
      const chunks = []
      let size = 0
      for (const p of Object.keys(data.platforms)) {
        const r = data.platforms[p]
        if (!r.items.length) continue
        const block = `【${r.label}】${r.total} 条\n` + r.items.slice(0, 20).map((it) => renderItem(it)).join('\n')
        if (size + block.length > MAX_TEXT && chunks.length) break
        chunks.push(block)
        size += block.length
      }
      return result(true,
        `已入库（searchId=${meta.search_id}）。按 cn-last30days 技能分析：先输出「数据速览」（公众号→小红书→抖音 TOP5 表格，标题带链接），再按话题综合撰写发现；报告写完用 action="report" 存档。需要更多条目用 action="list"。` +
        (Object.values(data.platforms).some((r) => r.error) ? ' 注意：有平台失败，如实转述不要编造。' : ''),
        chunks.join('\n\n'),
        buildFooter(data, meta.search_id))
    }

    // ── list ─────────────────────────────────────────────────────────────
    if (args.action === 'list') {
      const meta = resolveSearch(args.searchId)
      const raw = getRaw(meta.search_id)
      if (!raw) throw new Error(`搜索数据缺失：${meta.search_id}`)
      let pool = []
      if (args.platform) {
        if (!PLATFORM_KEYS.includes(args.platform)) throw new Error(`platform 只能是 ${PLATFORM_KEYS.join(' / ')} 之一`)
        pool = raw.platforms[args.platform]?.items || []
      } else {
        pool = Object.values(raw.platforms).flatMap((r) => r.items)
      }
      const offset = Math.max(Number(args.offset) || 0, 0)
      const limit = Math.min(Number(args.limit) || 30, 150)
      const slice = pool.slice(offset, offset + limit)
      if (!slice.length) return result(false, `没有更多条目（pool=${pool.length}，offset=${offset}）。`)
      const withDesc = args.withDesc === 'true' || args.withDesc === true
      const body = slice.map((it) => renderItem(it, withDesc)).join('\n')
      return result(true,
        `第 ${offset + 1}-${offset + slice.length} 条 / 共 ${pool.length}（${meta.keyword}）。引用时链接取 url 字段（优先）或 author_link。`,
        body.slice(0, MAX_TEXT))
    }

    // ── report ───────────────────────────────────────────────────────────
    if (args.action === 'report') {
      const meta = resolveSearch(args.searchId)
      const raw = getRaw(meta.search_id)
      if (!raw) throw new Error(`搜索数据缺失：${meta.search_id}`)
      const reportMd = String(args.reportMd || '').trim()
      if (reportMd) saveReportMd(meta.search_id, reportMd)
      const savedMd = reportMd || getReportMd(meta.search_id) || ''
      const html = formatReportHtml(raw, { maxItems: 50, reportMd: savedMd })
      const file = saveReportHtml(meta.search_id, html)
      return result(true,
        `HTML 报告已生成${savedMd ? '（研究报告已内嵌）' : '（纯数据版，研究报告待写）'}：${file}${savedMd ? '' : '。请撰写研究报告后再次 report 提交，或直接把分析输出给用户。'}桌面端 WebContentsView 会 deny window.open/target=_blank，报告只能在面板内查看——告诉用户点侧栏「社媒雷达 CN30」的搜索详情页再点「打开完整报告」（searchId=${meta.search_id}），不要把磁盘路径当成可点开的入口。把关键发现按 LAW 规则完整输出给用户。`,
        `报告文件: ${file}\n报告头: ${mdToHtml(savedMd).slice(0, 200)}…`)
    }

    // ── history ──────────────────────────────────────────────────────────
    if (args.action === 'history') {
      const list = listSearches({ limit: 20 })
      if (!list.length) return result(false, '还没有搜索记录。先 search。')
      const lines = list.map((r) => {
        const t = Object.entries(r.totals).map(([p, n]) => `${PLATFORMS[p]?.label || p}${n}`).join('/')
        return `${r.search_id}｜${r.keyword}｜${t}${r.has_report ? '｜有报告' : ''}${r.has_analysis ? '｜有研究' : ''}`
      })
      return result(true, `共 ${list.length} 次搜索（新→旧）。对历史记录操作传 searchId；report 可为旧记录补研究报告。`, lines.join('\n').slice(0, MAX_TEXT))
    }

    throw new Error(`未知 action：${args.action}`)
  },
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------
export function apply(ctx, config) {
  const skillDirs = [join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')]

  const toolWithConfig = { ...cn30SearchTool, execute(args) { return cn30SearchTool.execute(args, config) } }

  ctx.effect(() => ctx.tools.register(toolWithConfig), `${name}: tool`)
  ctx.effect(() => ctx.skills.registerProvider(() => createSkillProvider(skillDirs)), `${name}: skills`)
  if (config.injectRules !== false) {
    ctx.effect(() => ctx.systemPrompt.section(systemSection()), `${name}: workflow`)
  }
  ctx.effect(() => registerApi(ctx, { config }), `${name}: routes`)
}

export { publicMeta }
