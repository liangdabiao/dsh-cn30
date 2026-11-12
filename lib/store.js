// 社媒雷达 CN30 · 数据层。
//   $DSH_HOME/cn30/
//   ├── settings.json         api_key / api_base(测试用) / proxy_url
//   ├── searches/index.json   搜索索引（新→旧）
//   └── searches/<id>/
//       ├── meta.json         关键词/平台/条数/天数/统计
//       ├── raw.json          search() 完整结果（三平台条目）
//       ├── report.md         agent 撰写的研究报告 Markdown（可选）
//       └── report.html       最终 HTML 报告
// 原子写与 geo-analyzer 同款（tmp + rename）。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, normalize } from 'node:path'

export const DATA_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'cn30')
const SEARCHES_DIR = join(DATA_DIR, 'searches')
const INDEX_FILE = join(SEARCHES_DIR, 'index.json')
const SETTINGS_FILE = join(DATA_DIR, 'settings.json')

const nowIso = () => new Date().toISOString()

function readJson(file, fallback = null) {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  mkdirSync(SEARCHES_DIR, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
}

// ── 设置 ───────────────────────────────────────────────────────────────
export function getSettings() {
  return readJson(SETTINGS_FILE, {}) || {}
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch, updated_at: nowIso() }
  writeJson(SETTINGS_FILE, next)
  return next
}

// ── 搜索记录 ───────────────────────────────────────────────────────────
function searchDir(id) {
  const safe = String(id).replace(/[^\p{L}\p{N}_-]+/gu, '')
  if (!safe || safe !== String(id)) throw new Error('非法搜索 id')
  const dir = join(SEARCHES_DIR, safe)
  if (normalize(dir) !== normalize(join(SEARCHES_DIR, safe))) throw new Error('非法搜索 id')
  return dir
}

export function createSearchId(keyword) {
  const ts = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const slug = String(keyword).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'topic'
  return `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}${String(ts.getMilliseconds()).padStart(3, '0')}-${slug}`
}

// meta 对外视图（面板/工具历史用，剥掉条目数组）
export function publicMeta(meta) {
  return {
    search_id: meta.search_id,
    keyword: meta.keyword,
    platforms: meta.platforms || [],
    count: meta.count || 50,
    days: meta.days || 30,
    searched_at: meta.searched_at,
    date_range: meta.date_range || {},
    totals: meta.totals || {},
    total_items: meta.total_items || 0,
    has_report: existsSync(join(SEARCHES_DIR, meta.search_id, 'report.html')),
    has_analysis: existsSync(join(SEARCHES_DIR, meta.search_id, 'report.md')),
  }
}

export function saveSearch(data) {
  const id = createSearchId(data.keyword)
  const dir = searchDir(id)
  mkdirSync(dir, { recursive: true })
  writeJson(join(dir, 'raw.json'), { ...data, search_id: id })
  const totals = {}
  for (const [p, r] of Object.entries(data.platforms || {})) totals[p] = r.total
  const meta = {
    search_id: id,
    keyword: data.keyword,
    platforms: Object.keys(data.platforms || {}),
    count: data.count ?? 50,
    days: data.days ?? 30,
    searched_at: data.searched_at,
    date_range: data.date_range,
    totals,
    total_items: data.total_items,
  }
  writeJson(join(dir, 'meta.json'), meta)
  const index = getSearchIndex().filter((i) => i.search_id !== id)
  index.unshift({ search_id: id, searched_at: meta.searched_at })
  writeJson(INDEX_FILE, index.slice(0, 200))
  return meta
}

export function getMeta(searchId) {
  return readJson(join(searchDir(searchId), 'meta.json'))
}

export function getRaw(searchId) {
  return readJson(join(searchDir(searchId), 'raw.json'))
}

export function listSearches({ limit = 50 } = {}) {
  const index = getSearchIndex()
  const out = []
  for (const item of index.slice(0, limit)) {
    const meta = getMeta(item.search_id)
    if (meta) out.push(publicMeta(meta))
  }
  return out
}

function getSearchIndex() {
  return readJson(INDEX_FILE, []) || []
}

export function saveReportMd(searchId, md) {
  const dir = searchDir(searchId)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'report.md')
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, String(md ?? ''), 'utf8')
  renameSync(tmp, file)
  return file
}

export function getReportMd(searchId) {
  return readJson(join(searchDir(searchId), 'report.md'), null)
}

export function saveReportHtml(searchId, html) {
  const dir = searchDir(searchId)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'report.html')
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, html, 'utf8')
  renameSync(tmp, file)
  return file
}

export function readReportHtml(searchId) {
  const file = join(searchDir(searchId), 'report.html')
  return existsSync(file) ? file : null
}

export function deleteSearch(searchId) {
  const dir = searchDir(searchId)
  if (!existsSync(dir)) return { ok: false, error: `搜索记录不存在: ${searchId}` }
  rmSync(dir, { recursive: true, force: true })
  writeJson(INDEX_FILE, getSearchIndex().filter((i) => i.search_id !== searchId))
  return { ok: true }
}
