// cn30 搜索引擎：小红书/公众号走统一多平台接口，抖音走广域库接口翻页取满。
// 移植自 cn_last30days.py 的 search()/_search_dy_works。同步执行，秒级返回。
import {
  PLATFORMS, PLATFORM_KEYS, MULTI_PLATFORM_PATH, DY_SEARCH_PATH, DY_MAX_PAGE_SIZE, SOURCE_LABEL,
  postSearch, resolveApiKey, resolveApiBase,
} from './redfox.js'
import { dedupeNormalize } from './normalize.js'

export function dateRange(days, now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const start = new Date(now.getTime() - days * 86400_000)
  return { from: fmt(start), to: fmt(now) }
}

// 抖音广域库翻页（每页 ≤50，取满 count 条；页数上限与上游同式：count//50 + 余数?2:1）
async function searchDyWorks({ keyword, apiKey, apiBase, proxyUrl, count, startDate, endDate }) {
  const collected = []
  const maxPages = Math.floor(count / DY_MAX_PAGE_SIZE) + (count % DY_MAX_PAGE_SIZE ? 2 : 1)
  let pageNum = 1
  while (collected.length < count && pageNum <= maxPages) {
    const pageSize = Math.min(DY_MAX_PAGE_SIZE, count - collected.length)
    const result = await postSearch(DY_SEARCH_PATH, {
      keyword,
      source: SOURCE_LABEL,
      startDate,
      endDate,
      pageNum,
      pageSize,
    }, { apiKey, apiBase, proxyUrl })
    const articles = result?.data?.list
    if (!Array.isArray(articles) || !articles.length) break
    collected.push(...articles)
    if (articles.length < pageSize) break
    pageNum++
  }
  return collected
}

/**
 * 同步搜索三平台话题数据。
 * @returns { keyword, search_id?, searched_at, date_range, platforms: {xhs:{label,total,items,error?},...}, total_items }
 */
export async function search(keyword, { platforms, count = 50, days = 30, apiKey, apiBase, proxyUrl = '' } = {}) {
  const keys = (platforms?.length ? platforms : PLATFORM_KEYS).filter((p) => PLATFORM_KEYS.includes(p))
  const range = dateRange(days)
  const startDate = range.from
  const endDate = range.to

  const results = {}
  let creditError = null
  let unifiedError = null

  // 统一接口一次拿 xhs+gzh（只查 dy 时可跳过）；失败不中断——dy 照常查，错误落到平台 error 字段（对齐上游容错口径）
  let unified = {}
  if (keys.some((p) => p !== 'dy')) {
    try {
      const result = await postSearch(MULTI_PLATFORM_PATH, {
        keyword, source: SOURCE_LABEL, startDate, endDate,
      }, { apiKey, apiBase, proxyUrl })
      unified = result?.data || {}
    } catch (err) {
      unifiedError = String(err?.message || err)
      if (err?.name === 'InsufficientCreditsError') creditError = err
    }
  }

  for (const p of keys) {
    const conf = PLATFORMS[p]
    try {
      let articles
      if (p === 'dy') {
        articles = await searchDyWorks({ keyword, apiKey, apiBase, proxyUrl, count, startDate, endDate })
      } else {
        articles = unified[conf.result_key]
        if (articles && typeof articles === 'object' && !Array.isArray(articles)) articles = articles.articles
        if (!Array.isArray(articles)) articles = []
      }
      const items = dedupeNormalize(articles, p, count)
      results[p] = { platform: p, label: conf.label, items, total: items.length }
    } catch (err) {
      results[p] = { platform: p, label: conf.label, items: [], total: 0, error: String(err?.message || err) }
      if (err?.name === 'InsufficientCreditsError') creditError = err
    }
  }

  // 统一接口失败：xhs/gzh 标注错误（dy 已有自己的结果或错误）
  if (unifiedError) {
    for (const p of ['xhs', 'gzh']) {
      if (keys.includes(p) && results[p]) results[p].error = unifiedError
    }
  }
  // 积分不足：全平台补提示（上游行为：填 error 不抛出）
  if (creditError) {
    for (const p of keys) {
      if (!results[p].error) results[p].error = creditError.message
    }
  }

  const totalItems = Object.values(results).reduce((n, r) => n + r.total, 0)
  return {
    keyword,
    searched_at: new Date().toISOString(),
    date_range: range,
    platforms: results,
    total_items: totalItems,
  }
}

// 工具/面板共用的参数装配（settings + config + env → search opts）
export function searchOpts({ settings = {}, config = {} } = {}) {
  return {
    apiKey: resolveApiKey({ settings, config }),
    apiBase: resolveApiBase({ settings }),
    proxyUrl: config?.proxyUrl || settings.proxy_url || '',
  }
}
