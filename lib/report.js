// cn30 HTML 报告生成器。移植自 cn_last30days.py 的 format_as_html + _md_to_html/_md_inline，
// 网站风报告：hero + 平台统计卡 + 研究报告区（agent 撰写的 Markdown 内嵌）+ 平台 Tab 卡片列表。
import { fuzzyCount } from './normalize.js'

export const PLATFORM_META = {
  xhs: { primary: '#ff2442', bg: '#fff1f0', icon: '📕', name: '小红书' },
  dy: { primary: '#161823', bg: '#f5f5f5', icon: '🎵', name: '抖音' },
  gzh: { primary: '#07c160', bg: '#f0fff4', icon: '📖', name: '公众号' },
}

const esc = (t) => String(t ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ── 简易 Markdown → HTML（研究报告内嵌用；标题/分隔线/列表/粗体/链接）────────
const MD_INLINE_LINK = /\[([^\]]+)\]\(([^)]+)\)/g
const MD_BOLD = /\*\*(.+?)\*\*/g

function mdInline(text) {
  let t = esc(text)
  t = t.replace(MD_INLINE_LINK, (_m, label, url) => `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`)
  t = t.replace(MD_BOLD, (_m, body) => `<strong>${body}</strong>`)
  return t
}

export function mdToHtml(text) {
  const lines = String(text ?? '').split('\n')
  const out = []
  let inList = false
  let listTag = null
  const closeList = () => { if (inList) { out.push(`</${listTag}>`); inList = false; listTag = null } }
  for (const line of lines) {
    const stripped = line.trim()
    if (stripped.startsWith('### ')) { closeList(); out.push(`<h4>${mdInline(stripped.slice(4))}</h4>`) }
    else if (stripped.startsWith('## ')) { closeList(); out.push(`<h3>${mdInline(stripped.slice(3))}</h3>`) }
    else if (stripped.startsWith('# ')) { closeList(); out.push(`<h2>${mdInline(stripped.slice(2))}</h2>`) }
    else if (stripped === '---') { closeList(); out.push('<hr>') }
    else if (stripped.startsWith('- ')) {
      if (!inList || listTag !== 'ul') { closeList(); out.push('<ul>'); inList = true; listTag = 'ul' }
      out.push(`<li>${mdInline(stripped.slice(2))}</li>`)
    } else if (/^\d+\.\s/.test(stripped)) {
      if (!inList || listTag !== 'ol') { closeList(); out.push('<ol>'); inList = true; listTag = 'ol' }
      out.push(`<li>${mdInline(stripped.replace(/^\d+\.\s/, ''))}</li>`)
    } else if (!stripped) {
      closeList()
      out.push('')
    } else {
      closeList()
      out.push(`<p>${mdInline(stripped)}</p>`)
    }
  }
  closeList()
  return out.join('\n')
}

// ── 报告主体 ────────────────────────────────────────────────────────────

function platformCard(pkey, pdata, maxItems) {
  const meta = PLATFORM_META[pkey] || PLATFORM_META.xhs
  const eng = (it) => it.engagement || {}
  const totalLikes = pdata.items.slice(0, maxItems).reduce((n, it) => n + (eng(it).likes || 0), 0)
  return `
            <div class="stat-card" style="--p-color: ${meta.primary}; --p-bg: ${meta.bg}">
                <div class="stat-icon">${meta.icon}</div>
                <div class="stat-body">
                    <div class="stat-label">${esc(meta.name)}<span class="stat-likes">👍 ${fuzzyCount(totalLikes)}</span></div>
                    <div class="stat-num">${pdata.total} <small>条</small></div>
                </div>
            </div>`
}

function platformPanel(pkey, pdata, maxItems) {
  const meta = PLATFORM_META[pkey] || PLATFORM_META.xhs
  const mPrimary = meta.primary
  const items = (pdata.items || []).slice(0, maxItems)
  const errorHtml = pdata.error ? `<div class="error-banner">⚠️ ${esc(pdata.error)}</div>` : ''

  let cards = ''
  items.forEach((item, idx) => {
    const titleEsc = esc(item.title)
    const descEsc = item.desc ? esc(item.desc.slice(0, 200)) : ''
    const authorEsc = esc(item.author)
    const itemUrl = item.url || ''
    const urlAttr = itemUrl ? `href="${esc(itemUrl)}"` : 'href="#"'
    const authorLink = item.author_link || ''
    const authorHtml = authorLink
      ? `<a href="${esc(authorLink)}" class="author-link" target="_blank" rel="noreferrer">${authorEsc}</a>`
      : `<span class="author-name">${authorEsc}</span>`

    const eng = item.engagement || {}
    const f = fuzzyCount
    let engTags = ''
    if (pkey === 'gzh') {
      engTags = `<span class="eng-tag reads">📖 ${f(eng.reads)}</span><span class="eng-tag">👍 ${f(eng.likes)}</span><span class="eng-tag">🔄 ${f(eng.shares)}</span>`
    } else if (pkey === 'xhs') {
      engTags = `<span class="eng-tag">👍 ${f(eng.likes)}</span><span class="eng-tag">⭐ ${f(eng.collects)}</span><span class="eng-tag">💬 ${f(eng.comments)}</span>`
    } else if (pkey === 'dy') {
      engTags = `<span class="eng-tag">👍 ${f(eng.likes)}</span><span class="eng-tag">💬 ${f(eng.comments)}</span><span class="eng-tag">🔄 ${f(eng.shares)}</span>`
    }

    const pubDate = item.published_at ? String(item.published_at).slice(0, 10) : '--'
    const descHtml = descEsc ? `<p class="card-desc">${descEsc}</p>` : ''
    const fansHtml = pkey === 'gzh' ? '' : `<span class="dot">·</span><span class="fans">${esc(item.author_fans ?? '--')}粉</span>`

    cards += `
            <div class="card" style="--card-accent: ${mPrimary}">
                <div class="card-rank">${idx + 1}</div>
                <div class="card-body">
                    <a ${urlAttr} class="card-title" target="_blank" rel="noreferrer">${titleEsc}</a>
                    <div class="card-meta">
                        ${authorHtml}
                        ${fansHtml}
                        <span class="dot">·</span>
                        <span class="time">${esc(pubDate)}</span>
                    </div>
                    ${descHtml}
                    <div class="card-footer">
                        <div class="engagement">${engTags}</div>
                        <a ${urlAttr} class="view-btn" target="_blank" rel="noreferrer">查看原文 ↗</a>
                    </div>
                </div>
            </div>`
  })

  const xhsNotice = pkey === 'xhs'
    ? '<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:10px 14px;margin:16px 24px;color:#664d03;font-size:13px;line-height:1.6">⚠️ 受小红书风控规则限制，部分作品链接可能无法正常跳转，您可复制对应作品标题前往小红书搜索查看，感谢理解🙇‍♀️🙇‍♀️</div>'
    : ''
  const noData = items.length ? '' : "<div class='no-data-hint'><p>未查询到相关内容，建议更换关键词重试。</p></div>"

  return `
        <div class="tab-panel" id="panel-${pkey}" style="display: none">
            ${errorHtml}
            ${xhsNotice}
            <div class="card-list">
                ${cards}
            </div>
            ${noData}
        </div>`
}

/**
 * 生成完整 HTML。
 * @param data search() 结果（keyword/date_range/platforms/total_items）
 * @param opts { maxItems, reportMd } reportMd = agent 撰写的研究报告 Markdown（内嵌顶部）
 */
export function formatReportHtml(data, { maxItems = 50, reportMd = '' } = {}) {
  const keyword = data.keyword || ''
  const total = data.total_items || 0
  const range = data.date_range || {}

  const keys = Object.keys(data.platforms || {})
  const statsHtml = keys.map((k) => platformCard(k, data.platforms[k], maxItems)).join('\n')
  const tabsHtml = keys.map((pkey) => {
    const meta = PLATFORM_META[pkey] || PLATFORM_META.xhs
    const pdata = data.platforms[pkey]
    return `<button class="tab-btn${pkey === keys[0] ? ' active' : ''}" data-platform="${pkey}" style="--tab-color: ${meta.primary}">${meta.icon} ${esc(pdata.label || meta.name)} <span class="tab-count">${pdata.total}</span></button>`
  }).join('\n')
  const panelsHtml = keys.map((pkey) => {
    const html = platformPanel(pkey, data.platforms[pkey], maxItems)
    return pkey === keys[0] ? html.replace('style="display: none"', 'style="display: block"') : html
  }).join('\n')

  const reportSection = reportMd
    ? `
    <div class="report-section">
        <h2 class="section-title">📝 研究报告</h2>
        <div class="report-content">${mdToHtml(reportMd)}</div>
    </div>`
    : ''

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>社媒雷达 CN30 · ${esc(keyword)}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        :root {
            --primary: #4f46e5;
            --primary-light: #e0e7ff;
            --text: #1f2937;
            --text-secondary: #6b7280;
            --border: #e5e7eb;
            --bg: #f9fafb;
            --card-bg: #ffffff;
            --radius: 12px;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Noto Sans SC', Roboto, sans-serif;
            background: var(--bg); color: var(--text); line-height: 1.6;
        }
        .navbar {
            background: white; border-bottom: 1px solid var(--border);
            padding: 12px 24px; position: sticky; top: 0; z-index: 100;
            display: flex; align-items: center; gap: 12px;
        }
        .navbar .logo { font-size: 18px; font-weight: 800; color: var(--primary); letter-spacing: -0.5px; }
        .navbar .logo span { color: #ef4444; }
        .navbar .badge {
            background: var(--primary-light); color: var(--primary);
            font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 20px;
        }
        .hero {
            background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%);
            color: white; padding: 48px 24px; text-align: center;
        }
        .hero h1 { font-size: 28px; font-weight: 800; margin-bottom: 8px; }
        .hero .keyword {
            display: inline-block; background: rgba(255,255,255,0.15); border-radius: 8px;
            padding: 4px 16px; font-size: 16px; margin: 8px 0;
        }
        .hero .date-range { font-size: 14px; opacity: 0.8; }
        .stats-row {
            display: flex; gap: 16px; padding: 24px; max-width: 960px; margin: -28px auto 0;
            position: relative; z-index: 10; flex-wrap: wrap; justify-content: center;
        }
        .stat-card {
            background: white; border-radius: var(--radius); padding: 20px 24px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.08); flex: 1; min-width: 180px;
            display: flex; align-items: center; gap: 16px; border-left: 4px solid var(--p-color);
        }
        .stat-icon { font-size: 32px; }
        .stat-label { font-size: 13px; color: var(--text-secondary); }
        .stat-likes { float: right; opacity: .8; }
        .stat-num { font-size: 24px; font-weight: 800; color: var(--text); }
        .stat-num small { font-size: 13px; font-weight: 400; color: var(--text-secondary); }
        .main { max-width: 960px; margin: 24px auto; padding: 0 24px; }
        .tab-bar {
            display: flex; gap: 4px; background: white; border-radius: var(--radius) var(--radius) 0 0;
            padding: 8px 8px 0; border: 1px solid var(--border); border-bottom: none;
            flex-wrap: wrap;
        }
        .tab-btn {
            padding: 12px 24px; border: none; background: transparent;
            font-size: 15px; font-weight: 600; cursor: pointer; color: var(--text-secondary);
            border-radius: 8px 8px 0 0; transition: all 0.2s; position: relative;
        }
        .tab-btn:hover { background: var(--bg); color: var(--tab-color); }
        .tab-btn.active { background: var(--bg); color: var(--tab-color); }
        .tab-btn.active::after {
            content: ''; position: absolute; bottom: 0; left: 20%; right: 20%;
            height: 3px; background: var(--tab-color); border-radius: 3px 3px 0 0;
        }
        .tab-count {
            font-size: 12px; background: var(--bg); padding: 2px 8px;
            border-radius: 10px; font-weight: 500; margin-left: 4px;
        }
        .tab-btn.active .tab-count { background: var(--primary-light); color: var(--tab-color); }
        .card-list { background: white; border: 1px solid var(--border); border-radius: 0 0 var(--radius) var(--radius); }
        .card {
            display: flex; gap: 16px; padding: 20px 24px;
            border-bottom: 1px solid #f3f4f6; transition: background 0.15s;
        }
        .card:last-child { border-bottom: none; }
        .card:hover { background: #fafbfc; }
        .card-rank {
            font-size: 20px; font-weight: 800; color: var(--card-accent);
            min-width: 32px; text-align: center; padding-top: 2px; opacity: 0.8;
        }
        .card-body { flex: 1; min-width: 0; }
        .card-title {
            font-size: 16px; font-weight: 600; color: var(--text); text-decoration: none;
            line-height: 1.5; display: block; transition: color 0.15s;
        }
        .card-title:hover { color: var(--card-accent); }
        .card-meta { font-size: 13px; color: var(--text-secondary); margin-top: 6px; display: flex; align-items: center; gap: 0; flex-wrap: wrap; }
        .author-link { color: var(--primary); text-decoration: none; font-weight: 500; transition: color 0.15s; }
        .author-link:hover { color: var(--card-accent); text-decoration: underline; }
        .author-name { color: var(--primary); font-weight: 500; }
        .dot { margin: 0 6px; }
        .card-desc { font-size: 14px; color: var(--text-secondary); line-height: 1.6; margin-top: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .card-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
        .engagement { display: flex; gap: 8px; flex-wrap: wrap; }
        .eng-tag { font-size: 12px; color: var(--text-secondary); background: #f3f4f6; padding: 2px 8px; border-radius: 4px; }
        .eng-tag.reads { background: #ecfdf5; color: #065f46; }
        .view-btn {
            font-size: 13px; color: var(--card-accent); text-decoration: none;
            font-weight: 500; white-space: nowrap; transition: opacity 0.15s;
        }
        .view-btn:hover { opacity: 0.7; }
        .error-banner {
            background: #fef3c7; color: #92400e; padding: 12px 16px;
            border-radius: 8px; margin: 16px 24px; font-size: 14px;
        }
        .no-data-hint { text-align: center; color: var(--text-secondary); padding: 48px; }
        .report-section { max-width: 960px; margin: 0 auto; padding: 0 24px; }
        .section-title {
            font-size: 20px; font-weight: 800; color: var(--text); margin-bottom: 16px;
            padding-bottom: 8px; border-bottom: 2px solid var(--primary);
        }
        .report-content {
            background: white; border: 1px solid var(--border); border-radius: var(--radius);
            padding: 32px; line-height: 1.8; color: var(--text); font-size: 15px;
        }
        .report-content h2 { font-size: 20px; font-weight: 800; color: var(--primary); margin: 24px 0 12px; }
        .report-content h3 { font-size: 18px; font-weight: 700; color: var(--text); margin: 20px 0 10px; }
        .report-content h4 { font-size: 16px; font-weight: 700; color: var(--text); margin: 16px 0 8px; }
        .report-content p { margin-bottom: 12px; }
        .report-content strong { color: #1e1b4b; }
        .report-content a { color: var(--primary); text-decoration: none; }
        .report-content a:hover { text-decoration: underline; }
        .report-content ul, .report-content ol { margin: 8px 0 12px 20px; }
        .report-content li { margin-bottom: 4px; }
        .report-content hr { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
        .footer {
            text-align: center; color: var(--text-secondary); font-size: 12px;
            padding: 32px 24px; margin-top: 16px;
        }
        .footer a { color: var(--primary); text-decoration: none; }
        @media (max-width: 640px) {
            .hero { padding: 32px 16px; }
            .hero h1 { font-size: 20px; }
            .stats-row { padding: 16px; margin-top: -20px; }
            .stat-card { min-width: 140px; padding: 14px 16px; }
            .stat-num { font-size: 20px; }
            .main { padding: 0 12px; }
            .card { padding: 14px 16px; gap: 10px; }
            .card-rank { font-size: 16px; min-width: 24px; }
            .card-title { font-size: 15px; }
        }
    </style>
</head>
<body>
    <nav class="navbar">
        <div class="logo">🇨🇳 cn<span>-last30days</span></div>
        <div class="badge">dsh 社媒雷达</div>
    </nav>
    <div class="hero">
        <h1>中国社媒话题研究</h1>
        <div class="keyword">${esc(keyword)}</div>
        <div class="date-range">${esc(range.from || '')} ~ ${esc(range.to || '')}</div>
    </div>
    <div class="stats-row">
        ${statsHtml}
        <div class="stat-card" style="--p-color: var(--primary); --p-bg: var(--primary-light)">
            <div class="stat-icon">📊</div>
            <div class="stat-body">
                <div class="stat-label">合计</div>
                <div class="stat-num">${total} <small>条</small></div>
            </div>
        </div>
    </div>
    ${reportSection}
    <div class="main">
        <div class="tab-bar">
            ${tabsHtml}
        </div>
        ${panelsHtml}
    </div>
    <div class="footer">
        数据来源：<a href="https://redfox.hk" target="_blank" rel="noreferrer">redfox.hk</a> API · 小红书 / 抖音 / 公众号 · 近30天热门内容<br>
        互动数据为入库快照，实时数据可能持续增长
    </div>
    <script>
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
                btn.classList.add('active');
                document.getElementById('panel-' + btn.dataset.platform).style.display = 'block';
            });
        });
    </script>
</body>
</html>`
}
