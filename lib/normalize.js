// 三平台数据归一化：小红书/抖音/公众号 → 统一条目结构。
// Node 移植自 cn-last30days cn_last30days.py 的 _normalize_* / parse_count / fuzzy_count。
// 兼容上游遇到过的两代字段形态（work* 前缀 与 id/title 直给），别"简化"字段清单——
// 每一个别名都是线上真实响应里出现过的。

// '1.2w' / '5000+' / '3万' / '2亿' / 数字 → 整数
export function parseCount(value) {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0
  let text = String(value).replace(/\+/g, '').replace(/,/g, '').trim()
  if (!text) return 0
  try {
    const lower = text.toLowerCase()
    if (lower.includes('w')) return Math.round(parseFloat(lower.replace('w', '')) * 10000) || 0
    if (text.endsWith('万')) return Math.round(parseFloat(text.slice(0, -1)) * 10000) || 0
    if (text.endsWith('亿')) return Math.round(parseFloat(text.slice(0, -1)) * 1e8) || 0
    const n = parseFloat(text)
    return Number.isFinite(n) ? Math.round(n) : 0
  } catch {
    return 0
  }
}

// 互动数模糊化：<5000 原值；5000-9999 「5000+」；≥1w 「Nw+」
export function fuzzyCount(value) {
  const num = parseCount(value)
  if (num <= 0) return '--'
  if (num < 5000) return String(num)
  if (num < 10000) return '5000+'
  return `${Math.floor(num / 10000)}w+`
}

// 从字典按优先级取第一个非空值（上游 _first_of：0 也算空）
function firstOf(art, keys, fallback = null) {
  for (const k of keys) {
    const v = art?.[k]
    if (v !== null && v !== undefined && v !== '' && v !== 0) return v
  }
  return fallback
}

function msToDateTime(v) {
  if (typeof v === 'number' && v > 1e12) {
    const d = new Date(v)
    if (!Number.isNaN(d.getTime())) {
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    }
  }
  return String(v ?? '')
}

export function extractScores(art) {
  return {
    total: art?.totalScore ?? 0,
    relevance: art?.relevanceScore ?? 0,
    popularity: art?.popularityScore ?? 0,
    recency: art?.recencyScore ?? 0,
  }
}

export function normalizeXhs(art, idx) {
  const noteId = String(firstOf(art, ['workId', 'id', 'noteId', 'workUuid', 'uuid'], '') ?? '')
  const authorId = String(firstOf(art, ['accountUserid', 'authorId', 'accountId'], '') ?? '')
  const titleRaw = firstOf(art, ['workTitle', 'title', 'displayTitle'], '')
  const descRaw = firstOf(art, ['workDesc', 'desc', 'displayDesc', 'summary'], '')
  const title = String(titleRaw || descRaw || '无标题').slice(0, 200)
  const desc = String(descRaw || '').slice(0, 500)
  let noteLink = String(firstOf(art, ['workUrl', 'shareInfoLink', 'url'], '') ?? '')
  if (!noteLink && noteId) {
    const token = art.xsecToken || ''
    noteLink = `https://www.xiaohongshu.com/explore/${noteId}${token ? `?xsec_token=${token}` : ''}`
  }
  const pubTime = msToDateTime(firstOf(art, ['workPublishTime', 'createTime', 'publishTime', 'time'], ''))
  return {
    id: `XHS${idx}`,
    platform: '小红书',
    platform_key: 'xhs',
    title, desc,
    url: noteLink,
    author: String(firstOf(art, ['accountNickname', 'authorNickname', 'author', 'accountName', 'nickname'], '未知')),
    author_id: authorId,
    author_link: authorId ? `https://www.xiaohongshu.com/user/profile/${authorId}` : '',
    author_fans: fuzzyCount(firstOf(art, ['authorFans', 'followerCount'], 0)),
    published_at: pubTime,
    engagement: {
      likes: parseCount(firstOf(art, ['workLikedCount', 'likedCount', 'likeCount'], 0)),
      comments: parseCount(firstOf(art, ['workCommentsCount', 'commentsCount', 'commentCount'], 0)),
      collects: parseCount(firstOf(art, ['workCollectedCount', 'collectedCount', 'collectCount'], 0)),
      shares: parseCount(firstOf(art, ['workSharedCount', 'sharedCount', 'shareCount'], 0)),
      interactions: parseCount(firstOf(art, ['interactiveCount'], 0)),
    },
    engagement_display: '', // 由 fmtEngagement 补
    cover: String(firstOf(art, ['coverUrl', 'cover'], '')),
    scores: extractScores(art),
    account_type: String(firstOf(art, ['accountType'], '')),
    work_type: String(firstOf(art, ['workType', 'noteType'], '')),
  }
}

export function normalizeDy(art, idx) {
  const content = String(art?.content || '')
  const authorId = String(art?.authorSecUid || art?.authorUid || '')
  return {
    id: `DY${idx}`,
    platform: '抖音',
    platform_key: 'dy',
    title: (content || '无标题').slice(0, 200),
    desc: content.slice(0, 500),
    url: String(art?.opusUrl || ''),
    author: String(art?.authorName || '未知'),
    author_id: authorId,
    author_link: authorId ? `https://www.douyin.com/user/${authorId}` : '',
    author_fans: '--', // 广域库接口不返回粉丝数
    published_at: String(art?.publishTime || ''),
    engagement: {
      likes: parseCount(art?.likeCount ?? 0),
      comments: parseCount(art?.commentCount ?? 0),
      collects: parseCount(art?.collectCount ?? 0),
      shares: parseCount(art?.shareCount ?? 0),
    },
    engagement_display: '',
    cover: String(art?.coverUrl || ''),
    scores: extractScores(art),
  }
}

export function normalizeGzh(art, idx) {
  const summary = firstOf(art, ['summary', 'desc'], '')
  return {
    id: `GZH${idx}`,
    platform: '公众号',
    platform_key: 'gzh',
    title: String(art?.title || '无标题').slice(0, 200),
    desc: String(summary || '').slice(0, 500),
    url: String(firstOf(art, ['url', 'workUrl'], '') ?? ''),
    author: String(firstOf(art, ['author', 'accountName'], '-')),
    author_id: String(firstOf(art, ['accountId', 'authorId'], '') ?? ''),
    author_link: '',
    author_fans: fuzzyCount(firstOf(art, ['followerCount', 'authorFans'], 0)),
    published_at: String(firstOf(art, ['publicTime', 'publishTime', 'createTime'], '')),
    engagement: {
      reads: parseCount(firstOf(art, ['clicksCount', 'readCount'], 0)),
      likes: parseCount(firstOf(art, ['likeCount', 'likedCount'], 0)),
      watches: parseCount(firstOf(art, ['watchCount'], 0)),
      collects: parseCount(firstOf(art, ['collectCount', 'collectedCount'], 0)),
      shares: parseCount(firstOf(art, ['shareCount', 'sharedCount'], 0)),
      comments: parseCount(firstOf(art, ['commentsCount', 'commentCount'], 0)),
    },
    engagement_display: '',
    cover: String(firstOf(art, ['imageUrl', 'coverUrl', 'cover'], '')),
    scores: extractScores(art),
  }
}

const NORMALIZERS = { xhs: normalizeXhs, dy: normalizeDy, gzh: normalizeGzh }

export function normalizeArticle(art, platform, idx) {
  const fn = NORMALIZERS[platform]
  return fn ? fn(art, idx) : art
}

// 可读互动串（engagement_display）
export function fmtEngagement(item) {
  const f = fuzzyCount
  const eng = item.engagement || {}
  if (item.platform_key === 'xhs') {
    return `🔥${f(eng.interactions)}互动 👍${f(eng.likes)} ⭐${f(eng.collects)} 💬${f(eng.comments)}`
  }
  if (item.platform_key === 'dy') {
    return `👍${f(eng.likes)} 💬${f(eng.comments)} ⭐${f(eng.collects)} 🔄${f(eng.shares)}`
  }
  if (item.platform_key === 'gzh') {
    return `📖${f(eng.reads)} 👍${f(eng.likes)} 👁${f(eng.watches)} 💬${f(eng.comments)} 🔄${f(eng.shares)}`
  }
  return ''
}

// 平台清单去重后归一化（workUuid/uuid/videoId/workId/id/noteId 任意一个当主键）
export function dedupeNormalize(articles, platform, count) {
  const seen = new Set()
  const out = []
  for (const art of Array.isArray(articles) ? articles : []) {
    if (!art || typeof art !== 'object') continue
    const uid = art.workUuid || art.uuid || art.videoId || art.workId || art.id || art.noteId || ''
    if (uid) {
      if (seen.has(uid)) continue
      seen.add(uid)
    }
    const item = normalizeArticle(art, platform, out.length + 1)
    item.engagement_display = fmtEngagement(item)
    out.push(item)
    if (out.length >= count) break
  }
  return out
}
