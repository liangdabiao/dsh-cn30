// 面板数据面：/cn30 前缀路由（搜索执行 + 记录管理 + 报告 + 设置；综合研究走 agent 对话）。
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  saveSearch, getMeta, getRaw, listSearches, deleteSearch, getSettings, saveSettings,
  publicMeta, saveReportHtml, readReportHtml, saveReportMd, DATA_DIR,
} from './store.js'
import { search, searchOpts } from './engine.js'
import { formatReportHtml } from './report.js'
import { PLATFORM_KEYS, PLATFORMS } from './redfox.js'

const BASE = '/cn30'
const LAB = fileURLToPath(new URL('../lab/', import.meta.url))

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
}

function json(res, statusCode, value) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

export function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return false // dsh 0.2.x 宿主已 token 鉴权
  return connection.requestRejection({ headers: req.headers })
}

function safeFile(dir, rel) {
  if (!dir || String(rel).split('/').some((p) => p.startsWith('.'))) return null
  let base
  try { base = realpathSync(dir) } catch { return null }
  const file = normalize(join(base, rel))
  if (!file.startsWith(base + sep) || !existsSync(file)) return null
  const real = realpathSync(file)
  return real.startsWith(base + sep) && statSync(real).isFile() ? real : null
}

function serveFile(req, res, file) {
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': statSync(file).size,
    'cache-control': 'no-cache',
  })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

function readJson(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const origin = req.headers.origin
    if (req.method !== 'POST') return reject(Object.assign(new Error('method'), { status: 405 }))
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('type'), { status: 415 }))
    if (origin && origin.replace(/^https?:\/\//, '') !== req.headers.host) return reject(Object.assign(new Error('origin'), { status: 403 }))
    let size = 0
    const chunks = []
    req.on('data', (c) => { size += c.length; if (size > max) req.destroy(); else chunks.push(c) })
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (e) { reject(Object.assign(e, { status: 400 })) } })
    req.on('error', reject)
  })
}

function readVersion() {
  try { return JSON.parse(readFileSync(join(LAB, '..', 'package.json'), 'utf8')).version } catch { return '' }
}

function catalog() {
  const settings = getSettings()
  return {
    version: readVersion(),
    dataDir: DATA_DIR,
    has_key: Boolean(settings.api_key || process.env.REDFOX_API_KEY || process.env.X_API_KEY),
    key_source: settings.api_key ? 'settings' : ((process.env.REDFOX_API_KEY || process.env.X_API_KEY) ? 'env' : 'none'),
    platforms: PLATFORM_KEYS.map((k) => ({ key: k, label: PLATFORMS[k].label })),
    searches: listSearches({ limit: 50 }),
    settings: { proxy_url: settings.proxy_url || '', api_base: settings.api_base || '' },
  }
}

export function registerApi(ctx, hooks = {}) {
  return ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    async handler(req, res) {
      try {
        const rejection = requestRejection(ctx, req)
        if (typeof rejection === 'number') return json(res, rejection, { error: '未授权' })

        const url = new URL(req.url, 'http://x')
        if (!url.pathname.startsWith(BASE + '/') && url.pathname !== BASE) return json(res, 404, { error: 'not found' })
        const path = decodeURIComponent(url.pathname.slice(BASE.length)) || '/'

        // ---- API ----
        if (path === '/api/catalog' && req.method === 'GET') return json(res, 200, catalog())

        if (path === '/api/searches' && req.method === 'GET') return json(res, 200, { searches: listSearches({ limit: 100 }) })

        if (path === '/api/searches' && req.method === 'POST') {
          try {
            const body = await readJson(req)
            const keyword = String(body.keyword || '').trim()
            if (!keyword) return json(res, 400, { ok: false, error: '关键词必填' })
            const platforms = Array.isArray(body.platforms) && body.platforms.length ? body.platforms : PLATFORM_KEYS
            const bad = platforms.filter((p) => !PLATFORM_KEYS.includes(p))
            if (bad.length) return json(res, 400, { ok: false, error: `未知平台：${bad.join(',')}` })
            const opts = searchOpts({ settings: getSettings(), config: hooks.config })
            if (!opts.apiKey) return json(res, 400, { ok: false, error: '未配置 RedFox API Key（设置页或插件配置/环境变量 REDFOX_API_KEY）' })
            const data = await search(keyword, {
              ...opts,
              platforms,
              count: Math.min(Math.max(Number(body.count) || 50, 1), 50),
              days: Math.min(Math.max(Number(body.days) || 30, 1), 30),
            })
            data.count = Math.min(Math.max(Number(body.count) || 50, 1), 50)
            data.days = Math.min(Math.max(Number(body.days) || 30, 1), 30)
            const meta = saveSearch(data)
            return json(res, 200, { ok: true, search: publicMeta(meta) })
          } catch (e) { return json(res, e.status || 400, { ok: false, error: e.message }) }
        }

        const sMatch = path.match(/^\/api\/searches\/([^/]+)(\/.*)?$/)
        if (sMatch) {
          const searchId = sMatch[1]
          const sub = sMatch[2] || ''
          const meta = getMeta(searchId)
          if (!meta) return json(res, 404, { error: `搜索记录不存在: ${searchId}` })

          if (!sub && req.method === 'GET') {
            const raw = getRaw(searchId)
            return json(res, 200, { search: publicMeta(meta), raw: raw || null })
          }
          if (!sub && req.method === 'DELETE') return json(res, 200, deleteSearch(searchId))
          if (sub === '/report' && (req.method === 'GET' || req.method === 'HEAD')) {
            const file = readReportHtml(searchId)
            if (!file) return json(res, 404, { error: '报告还没生成——在对话里让 agent 跑 cn30_search(action="report")，或先搜索' })
            return serveFile(req, res, file)
          }
          if (sub === '/report' && req.method === 'POST') {
            // 面板直出：纯数据版 HTML（无研究报告），或已有 md 重渲染
            try {
              const raw = getRaw(searchId)
              if (!raw) return json(res, 404, { ok: false, error: '搜索数据缺失' })
              await readJson(req).catch(() => ({}))
              const html = formatReportHtml(raw, { maxItems: 50 })
              const file = saveReportHtml(searchId, html)
              return json(res, 200, { ok: true, file })
            } catch (e) { return json(res, e.status || 400, { ok: false, error: e.message }) }
          }
          if (sub === '/analysis-md' && req.method === 'POST') {
            try {
              const body = await readJson(req)
              const md = String(body.md || '').trim()
              if (!md) return json(res, 400, { ok: false, error: 'md 必填' })
              saveReportMd(searchId, md)
              const raw = getRaw(searchId)
              const html = formatReportHtml(raw, { maxItems: 50, reportMd: md })
              saveReportHtml(searchId, html)
              return json(res, 200, { ok: true })
            } catch (e) { return json(res, e.status || 400, { ok: false, error: e.message }) }
          }
          return json(res, 404, { error: 'not found' })
        }

        if (path === '/api/settings' && req.method === 'GET') {
          const settings = getSettings()
          const key = String(settings.api_key || '')
          return json(res, 200, {
            settings: {
              has_key: Boolean(key || process.env.REDFOX_API_KEY || process.env.X_API_KEY),
              key_tail: key ? key.slice(-6) : '',
              from_env: Boolean(process.env.REDFOX_API_KEY || process.env.X_API_KEY),
              proxy_url: settings.proxy_url || '',
              api_base: settings.api_base || '',
            },
          })
        }
        if (path === '/api/settings' && req.method === 'POST') {
          try {
            const body = await readJson(req)
            const patch = {}
            if (body.api_key !== undefined) {
              const key = String(body.api_key).trim()
              if (key && !key.startsWith('ak_')) return json(res, 400, { ok: false, error: 'RedFox API Key 以 ak_ 开头，请检查' })
              patch.api_key = key
            }
            if (body.proxy_url !== undefined) patch.proxy_url = String(body.proxy_url).trim()
            if (body.api_base !== undefined) patch.api_base = String(body.api_base).trim()
            const next = saveSettings(patch)
            return json(res, 200, { ok: true, has_key: Boolean(next.api_key || process.env.REDFOX_API_KEY) })
          } catch (e) { return json(res, e.status || 400, { ok: false, error: e.message }) }
        }
        if (path.startsWith('/api/')) return json(res, 404, { error: 'not found' })

        // ---- 静态页面 ----
        if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method' })
        const file = safeFile(LAB, path === '/' ? 'index.html' : path.replace(/^\/+/, ''))
        return file ? serveFile(req, res, file) : json(res, 404, { error: 'not found' })
      } catch (err) {
        json(res, 500, { error: err?.message || '内部错误' })
      }
    },
  })
}
