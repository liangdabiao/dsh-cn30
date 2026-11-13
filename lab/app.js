// 社媒雷达 CN30 · 面板逻辑：概览（搜索表单+历史）/ 结果页（三平台 tab 卡片）/ 设置。
// 话题综合研究走 agent 对话：嵌入 dsh → postMessage（client.js startSession，有 start-ok 握手）；
// 独立浏览器预览 → 复制草稿。面板直连 API 做搜索/看结果/直出纯数据报告。
(() => {
  const $app = document.getElementById('app')
  const $toast = document.getElementById('toast')
  const EMBEDDED = (() => { try { return window.parent !== window } catch { return false } })()

  const state = { catalog: null, platform: null }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  const PLAT = {
    xhs: { label: '小红书', color: '#ff2442', icon: '📕' },
    dy: { label: '抖音', color: '#161823', icon: '🎵' },
    gzh: { label: '公众号', color: '#07c160', icon: '📖' },
  }

  async function api(path) {
    const res = await fetch(`/cn30${path}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error(body.error || `HTTP ${res.status}`)
      err.status = res.status
      throw err
    }
    return body
  }
  async function apiPost(path, payload) {
    const res = await fetch(`/cn30${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    return body
  }
  async function apiDelete(path) {
    const res = await fetch(`/cn30${path}`, { method: 'DELETE' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    return body
  }

  // 打开外部链接：桌面端 iframe 里 window.open 会被 WebContentsView deny，
  // 先请宿主用系统默认浏览器打开；宿主不支持（网页版/无桌面）时退回新窗口。
  async function openLink(u) {
    if (!u || u === '#' || u === 'about:blank') return
    try {
      const r = await apiPost('/api/open', { url: u })
      if (r?.ok) { toast('已在系统浏览器打开'); return }
      throw new Error(r?.error || '打开失败')
    } catch (e) {
      const win = window.open(u, '_blank', 'noopener')
      if (!win) {
        const hint = /404|not found/i.test(String(e.message))
          ? '宿主还没重启（/api/open 未上线），重启 dsh 后就能用系统浏览器打开'
          : e.message
        toast(`链接打不开：${hint}`, true)
      }
    }
  }

  // 面板里的外链一律交给系统浏览器（桌面端 <a target="_blank"> 同样会被 deny）
  function bindExternalLinks() {
    document.querySelectorAll('a[target="_blank"]').forEach((a) => {
      a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openLink(a.getAttribute('href')) }
    })
  }

  let toastTimer = null
  function toast(msg, isErr) {
    $toast.textContent = msg
    $toast.className = `toast show${isErr ? ' err' : ''}`
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { $toast.className = 'toast' }, 2600)
  }
  function copyFallback(prompt, reason) {
    navigator.clipboard?.writeText(prompt).then(
      () => toast(`${reason}，草稿已复制到剪贴板——请粘贴到 dsh 对话`, true),
      () => toast(`${reason}，复制也失败了`, true))
  }

  const ICONS = {
    home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    go: '<path d="M9 6l6 6-6 6"/>',
    trash: '<path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M7 7l1 13h8l1-13"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    ext: '<path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M18 14v5H5V6h5"/>',
    back: '<path d="M14 6l-6 6 6 6"/>',
    play: '<path d="M8 5l11 7-11 7V5z"/>',
  }
  const ic = (name, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`

  async function loadCatalog() {
    state.catalog = await api('/api/catalog')
    renderNavCounts()
    renderRailFoot()
    return state.catalog
  }
  function renderNavCounts() {
    const c = state.catalog
    if (!c) return
    document.querySelectorAll('[data-count]').forEach((n) => {
      if (n.dataset.count === 'searches') n.textContent = (c.searches || []).length
    })
  }
  function renderRailFoot() {
    const c = state.catalog
    if (!c) return
    const latest = (c.searches || [])[0]
    document.getElementById('rail-foot').innerHTML =
      `<div class="v-head">CN30 RADAR v${esc(c.version)}</div>` +
      `<div class="v-row"><span>API Key</span><span>${c.has_key ? '已配置' : '未配置'}</span></div>` +
      `<div class="v-row"><span>搜索数</span><span>${(c.searches || []).length}</span></div>` +
      `<div class="v-row"><span>最近话题</span><span>${esc(latest?.keyword || '—')}</span></div>`
  }

  // ---------- 送 prompt 到 agent 对话 ----------
  function sendAgentPrompt(prompt, okMsg = '已在宿主开新对话——agent 处理中') {
    if (!EMBEDDED) {
      navigator.clipboard?.writeText(prompt).then(
        () => toast('草稿已复制——粘贴到 dsh 对话即可开始'),
        () => copyFallback(prompt, '复制失败'))
      return
    }
    let done = false
    const cleanup = () => { done = true; clearTimeout(timer); removeEventListener('message', onMsg) }
    const onMsg = (e) => {
      if (e.origin !== location.origin) return
      if (e.data?.type === 'cn30:start-ok') { if (!done) { cleanup(); toast(okMsg) } }
      else if (e.data?.type === 'cn30:start-failed') { if (!done) { cleanup(); toast(`没能开新对话：${e.data.message || ''}`, true) } }
    }
    const timer = setTimeout(() => { if (!done) { cleanup(); copyFallback(prompt, '未收到宿主确认') } }, 1500)
    addEventListener('message', onMsg)
    parent.postMessage({ type: 'cn30:refresh', prompt }, location.origin)
  }

  function researchPrompt(keyword, searchId) {
    return [
      `请研究国内社媒近 30 天关于「${keyword}」的真实讨论：`,
      `1. cn30_search(action="list", searchId="${searchId}") 分平台补读条目（每平台几十条）`,
      '2. 按 cn-last30days 技能综合分析：按话题叙事而非按平台罗列，跨平台交叉验证，高互动内容权重高；引用一律内联 Markdown 链接',
      '3. 撰写研究报告，然后 cn30_search(action="report", searchId="' + searchId + '", reportMd=…) 存档内嵌 HTML',
      '4. 按 LAW 规则输出给用户：数据速览（公众号→小红书→抖音 TOP5 表格）→ 我的发现 → 核心发现 → 引擎页脚逐字附带。',
    ].join('\n')
  }

  // ---------- 视图：概览 ----------
  function viewHome() {
    const c = state.catalog
    const searches = c.searches || []
    const platChecks = (c.platforms || []).map((p) =>
      `<label><input type="checkbox" name="plat" value="${esc(p.key)}" checked>${esc(p.label)}</label>`).join('')
    return `
      <header class="head">
        <span class="eyebrow">CN30 SOCIAL RADAR</span>
        <div class="head-row">
          <h1>社媒<strong>雷达</strong></h1>
        </div>
        <p>小红书 / 抖音 / 公众号三大平台近 30 天真实讨论：种草信号（收藏/点赞比）、传播力（分享数）、行业深度（阅读量）。RedFox API Key ${c.has_key ? '已配置' : '未配置——去「设置」页填写'}。</p>
      </header>
      ${!c.has_key ? `<div class="empty" style="margin-bottom:var(--sp-6);padding:var(--sp-4) var(--sp-5);text-align:left"><div class="e-title">🔑 还没有配置 RedFox API Key</div><p>到<a href="#/settings">「设置」</a>页填写（ak_ 开头，<a href="https://redfox.hk/settings/api-keys?source=github" target="_blank" rel="noreferrer">红狐 hub 获取 ↗</a>）。</p></div>` : ''}
      <section class="sec" style="margin-top:0">
        <div class="sec-head"><span class="num">01</span><h2>话题搜索</h2></div>
        <div class="form" style="max-width:760px">
          <div class="field"><label>KEYWORD · 话题关键词（多词英文逗号分隔，相关词合并一次查）</label>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <input id="f-kw" placeholder="如：AI视频工具,AI生成视频" style="flex:1;min-width:220px">
              <button class="btn accent" id="f-search">${ic('play')}搜索三平台</button>
              <button class="btn ghost" data-newflow>${ic('spark')}去对话研究</button>
            </div>
            <div class="hint">同步秒回。话题太模糊（"工具"）会被追问具体化；agent 也会先做预研再合并关键词。</div>
          </div>
          <div class="form-row">
            <div class="field"><label>PER PLATFORM · 每平台条数</label>
              <select id="f-count"><option value="20">20</option><option value="50" selected>50</option></select></div>
            <div class="field"><label>RANGE · 时间范围（天）</label>
              <select id="f-days"><option value="7">近 7 天</option><option value="14">近 14 天</option><option value="30" selected>近 30 天</option></select></div>
          </div>
          <div class="field"><label>PLATFORMS · 平台</label><div class="checks">${platChecks}</div></div>
          <div class="hint" id="f-status"></div>
        </div>
      </section>
      <section class="sec">
        <div class="sec-head"><span class="num">02</span><h2>搜索历史</h2></div>
        ${searches.length ? `<div class="cards">${searches.map((r) => `
          <a class="card" href="#/s/${encodeURIComponent(r.search_id)}">
            <div class="c-top">
              <div class="c-title">${esc(r.keyword)}</div>
              ${r.has_report ? '<span class="chip done">有报告</span>' : '<span class="chip">待研究</span>'}
            </div>
            <div class="c-sub">共 ${r.total_items} 条 · ${Object.entries(r.totals).map(([p, n]) => `${esc(PLAT[p]?.label || p)} ${n}`).join(' / ')}${Object.keys(r.errors || {}).length ? ` · <span style="color:#e05a4e">${Object.keys(r.errors).length} 个平台失败</span>` : ''}</div>
            <div class="c-foot"><span>${esc(String(r.searched_at).slice(0, 16).replace('T', ' '))}</span><span style="margin-left:auto">${esc(r.date_range?.from || '')} ~ ${esc(r.date_range?.to || '')}</span></div>
          </a>`).join('')}</div>`
        : `<div class="empty"><div class="e-title">还没有搜索记录</div><p>输入话题点「搜索三平台」，或「去对话研究」让 agent 预研关键词后带你看三平台讨论与舆情趋势。</p></div>`}
      </section>`
  }

  // ---------- 视图：搜索结果 ----------
  function platColor(k) { return PLAT[k]?.color || 'var(--accent)' }

  function renderItems(container, pkey, items) {
    if (!items.length) {
      container.innerHTML = '<div class="empty-inline">该平台没有查到相关内容，建议换更口语化的关键词。</div>'
      return
    }
    container.innerHTML = items.map((it, i) => `
      <div class="plate" style="--pc:${esc(platColor(pkey))}">
        <div class="rank">${i + 1}</div>
        <div class="p-main">
          <div class="p-title">${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noreferrer">${esc(it.title)}</a>` : esc(it.title)}</div>
          <div class="p-meta">${it.author_link ? `<a href="${esc(it.author_link)}" target="_blank" rel="noreferrer">@${esc(it.author)}</a>` : `@${esc(it.author)}`} · ${esc(it.published_at ? String(it.published_at).slice(0, 10) : '--')}${pkey !== 'gzh' ? ` · ${esc(it.author_fans || '--')}粉` : ''}</div>
          ${it.desc ? `<div class="p-desc">${esc(it.desc)}</div>` : ''}
          <div class="p-eng">${(it.engagement_display || '').split(' ').filter(Boolean).map((seg) => `<span>${esc(seg)}</span>`).join('')}</div>
        </div>
        ${it.url ? `<a class="p-go" href="${esc(it.url)}" target="_blank" rel="noreferrer" title="查看原文">${ic('ext')}</a>` : ''}
      </div>`).join('')
    bindExternalLinks()
  }

  async function viewSearch(id) {
    let data
    try {
      data = await api(`/api/searches/${encodeURIComponent(id)}`)
    } catch (e) {
      const netDown = !e.status
      return `<a class="back" href="#/">${ic('back')} 概览</a><div class="empty"><div class="e-title">${netDown ? '面板服务连接失败' : '搜索记录不存在'}</div><p>${netDown ? '开发预览：DSH_HOME=<数据目录> node scripts/devserver.mjs' : esc(e.message)}</p></div>`
    }
    const meta = data.search
    const raw = data.raw
    const platKeys = meta.platforms || []
    const cur = state.platform && platKeys.includes(state.platform) ? state.platform : platKeys[0]

    const pstats = platKeys.map((k) => {
      const r = raw?.platforms?.[k] || {}
      const likes = (r.items || []).reduce((n, it) => n + (it.engagement?.likes || 0), 0)
      return `<div class="pstat" style="--pc:${esc(platColor(k))}">
        <div class="p-name">${esc(PLAT[k]?.label || k)}</div>
        <div class="p-num">${r.total ?? 0}<span class="unit" style="font-size:12px;color:var(--text-helper)"> 条</span></div>
        <div class="p-sub">👍 ${likes >= 10000 ? Math.floor(likes / 10000) + 'w+' : likes}</div>
        ${r.error ? `<div class="p-err">${esc(r.error)}</div>` : ''}
      </div>`
    }).join('')

    const tabs = platKeys.map((k) =>
      `<button class="ptab${k === cur ? ' on' : ''}" data-plat="${k}" style="--pt:${esc(platColor(k))}">${PLAT[k]?.icon || ''} ${esc(PLAT[k]?.label || k)} <span class="n">${raw?.platforms?.[k]?.total ?? 0}</span></button>`).join('')

    // 不用 <a target="_blank">：桌面端 WebContentsView 对 window.open 一律 deny，
    // 同源 dsh-app: 地址既不开新窗口也不交给系统浏览器，点了没反应。改成面板内嵌查看器。
    const reportBtn = meta.has_report
      ? `<button class="btn accent" data-open-report="${esc(id)}">${ic('ext')}打开完整报告</button>`
      : `<button class="btn ghost" id="raw-report">${ic('play')}直出纯数据版报告</button>`

    return `
      <a class="back" href="#/">${ic('back')} 概览</a>
      <div class="detail-head">
        <div>
          <h1>${esc(meta.keyword)}</h1>
          <div class="c-sub" style="margin-top:4px">${esc(meta.date_range?.from || '')} ~ ${esc(meta.date_range?.to || '')}（近 ${meta.days} 天）· 每平台 ${meta.count} 条</div>
        </div>
        <div class="actions">
          ${reportBtn}
          <button class="btn ghost" data-research="${esc(id)}">${ic('spark')}去对话写研究报告</button>
          <button class="btn ghost" data-del-search="${esc(id)}" title="删除记录">${ic('trash')}</button>
        </div>
      </div>
      ${meta.has_analysis ? '' : '<div class="empty" style="padding:var(--sp-4) var(--sp-5);text-align:left;margin-bottom:var(--sp-5)"><div class="e-title">📝 还没有研究报告</div><p>点「去对话写研究报告」——agent 按话题综合三平台讨论，写完内嵌进 HTML 报告。</p></div>'}
      <div class="pstats">${pstats}</div>
      <div class="ptabs" style="margin-bottom:0">${tabs}</div>
      <div class="plates" id="plat-items"><div class="loading">LOADING…</div></div>`
  }

  function bindSearch(id, raw) {
    document.querySelectorAll('.ptab').forEach((b) => {
      b.onclick = () => {
        state.platform = b.dataset.plat
        document.querySelectorAll('.ptab').forEach((x) => x.classList.toggle('on', x === b))
        const items = raw?.platforms?.[state.platform]?.items || []
        renderItems(document.getElementById('plat-items'), state.platform, items)
      }
    })
    const first = document.querySelector('.ptab.on')
    if (first) renderItems(document.getElementById('plat-items'), state.platform || first.dataset.plat, raw?.platforms?.[state.platform || first.dataset.plat]?.items || [])
    const del = document.querySelector('[data-del-search]')
    if (del) del.onclick = async () => {
      if (!confirm('删除这条搜索记录？（条目与报告一并删除，不可恢复）')) return
      try {
        await apiDelete(`/api/searches/${encodeURIComponent(id)}`)
        toast('已删除')
        location.hash = '#/'
      } catch (e) { toast(e.message, true) }
    }
    const research = document.querySelector('[data-research]')
    if (research) research.onclick = () => {
      const kw = document.querySelector('.detail-head h1')?.textContent || ''
      sendAgentPrompt(researchPrompt(kw, id), '已在宿主开新对话——agent 分析完回来看报告')
    }
    const rawBtn = document.getElementById('raw-report')
    if (rawBtn) rawBtn.onclick = async () => {
      rawBtn.disabled = true
      try {
        await apiPost(`/api/searches/${encodeURIComponent(id)}/report`)
        toast('纯数据版报告已生成')
        location.reload()
      } catch (e) { toast(e.message, true); rawBtn.disabled = false }
    }
  }

  // ---------- 报告查看器（面板内嵌，不依赖新窗口） ----------
  // 桌面端 dsh-app 协议的 WebContentsView 把 window.open/target=_blank 全部 deny（只有 https:
  // 会交给系统浏览器），所以报告只能用面板内覆盖层显示：fetch 同源 HTML → iframe.srcdoc。
  async function openReportView(id) {
    document.getElementById('report-view')?.remove()
    const el = document.createElement('div')
    el.id = 'report-view'
    el.className = 'report-view'
    el.innerHTML = `
      <div class="rv-panel" role="dialog" aria-modal="true" aria-label="研究报告">
        <div class="rv-bar">
          <div class="rv-title">${ic('list')}<span>研究报告</span></div>
          <div class="rv-actions">
            <button class="btn ghost" id="rv-close">关闭</button>
          </div>
        </div>
        <div class="rv-body"><div class="loading">LOADING…</div></div>
      </div>`
    document.body.appendChild(el)
    const body = el.querySelector('.rv-body')
    const close = () => {
      removeEventListener('keydown', onKey)
      el.remove()
    }
    const onKey = (e) => { if (e.key === 'Escape') close() }
    addEventListener('keydown', onKey)
    el.querySelector('#rv-close').onclick = close
    el.addEventListener('click', (e) => { if (e.target === el) close() })
    try {
      const res = await fetch(`/cn30/api/searches/${encodeURIComponent(id)}/report`, { cache: 'no-store' })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error || `HTTP ${res.status}`)
      }
      const html = await res.text()
      const frame = document.createElement('iframe')
      frame.className = 'rv-frame'
      frame.title = '研究报告'
      frame.srcdoc = html // 报告自带的样式/脚本（平台 tab 切换）原样执行
      body.innerHTML = ''
      body.appendChild(frame)
    } catch (e) {
      body.innerHTML = `<div class="empty"><div class="e-title">报告打不开</div><p>${esc(e.message)}</p><p>若是「报告还没生成」，先在对话里让 agent 跑一次 cn30_search(action="report")。</p></div>`
    }
  }

  // ---------- 视图：设置 ----------
  function viewSettings() {
    return `
      <a class="back" href="#/">${ic('back')} 概览</a>
      <header class="head">
        <span class="eyebrow">SETTINGS</span>
        <h1>设<strong>置</strong></h1>
        <p>RedFox API Key 是三平台搜索的唯一凭证。这里保存的 Key 优先于环境变量，低于插件配置。</p>
      </header>
      <div class="form">
        <div class="field"><label>API KEY · RedFox API Key（ak_ 开头）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="s-key" placeholder="ak_…" style="flex:1;min-width:220px;font-family:var(--font-mono);font-size:12px">
            <button class="btn" id="s-key-save">保存 Key</button>
          </div>
          <div class="hint" id="s-key-hint">…</div>
          <div class="hint">获取：<a href="https://redfox.hk/settings/api-keys?source=github" target="_blank" rel="noreferrer">redfox.hk/settings/api-keys ↗</a>。保存在本机 dsh 数据目录，不上传。</div>
        </div>
        <div class="field"><label>PROXY · HTTP(S) 代理（访问 redfox.hk 走代理时填；清空 = 直连）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="s-proxy" placeholder="http://127.0.0.1:7890" style="flex:1;min-width:220px;font-family:var(--font-mono);font-size:12px">
            <button class="btn" id="s-proxy-save">保存代理</button>
          </div>
        </div>
        <div class="field"><label>API BASE · 接口地址（测试/自建网关用，默认 https://redfox.hk）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="s-base" placeholder="https://redfox.hk" style="flex:1;min-width:220px;font-family:var(--font-mono);font-size:12px">
            <button class="btn" id="s-base-save">保存地址</button>
          </div>
        </div>
      </div>`
  }

  async function bindSettings() {
    // 设置页的提示/占位符/输入值统一由服务端状态刷新（保存后也要再刷一次，否则提示还是旧的）
    async function refreshSettings() {
      try {
        const { settings } = await api('/api/settings')
        const keyHint = document.getElementById('s-key-hint')
        if (keyHint) keyHint.textContent = settings.has_key
          ? `已配置（…${settings.key_tail || '******'}${settings.from_env ? '，其中环境变量可用' : ''}）。重新输入会覆盖。`
          : '未配置。'
        const inp = document.getElementById('s-key')
        if (inp && document.activeElement !== inp) inp.placeholder = settings.has_key ? `已配置（…${settings.key_tail}），输入新值覆盖` : 'ak_…'
        const proxy = document.getElementById('s-proxy')
        if (proxy && document.activeElement !== proxy) proxy.value = settings.proxy_url || ''
        const base = document.getElementById('s-base')
        if (base && document.activeElement !== base) base.value = settings.api_base || ''
      } catch { /* 宿主未就绪 */ }
    }
    await refreshSettings()
    const bind = (id, payload, clearInput = false) => {
      const btn = document.getElementById(id)
      if (!btn) return
      btn.onclick = async () => {
        try {
          const input = btn.parentElement.querySelector('input')
          await apiPost('/api/settings', payload(input.value.trim()))
          toast('设置已保存')
          if (clearInput) input.value = ''
          await refreshSettings()
          loadCatalog().catch(() => {})
        } catch (e) { toast(e.message, true) }
      }
    }
    bind('s-key-save', (v) => ({ api_key: v }), true)
    bind('s-proxy-save', (v) => ({ proxy_url: v }))
    bind('s-base-save', (v) => ({ api_base: v }))
  }

  // ---------- 渲染辅助 ----------
  function bindCommon() {
    bindExternalLinks()
    document.querySelectorAll('[data-newflow]').forEach((b) => {
      b.onclick = () => sendAgentPrompt([
        '请研究国内社媒近 30 天关于某个话题的真实讨论（社媒雷达 CN30）：',
        '1. 我会告诉你话题；太模糊先追问具体化',
        '2. cn30_search(action="search", keyword="相关词1,相关词2", platforms="xhs,dy,gzh", count=50, days=30)（相关词合并一次查）',
        '3. 按 cn-last30days 技能综合分析 → cn30_search(action="report", reportMd=…) 内嵌 HTML',
        '4. 按 LAW 规则输出：数据速览 → 我的发现 → 核心发现 → 页脚逐字附带。',
        '现在请先问我想研究什么话题。',
      ].join('\n'), '已在宿主开新对话——agent 会先问你话题')
    })
    // 绑定在 bindCommon 里：条目接口失败时按钮也在，报告仍应能打开
    document.querySelectorAll('[data-open-report]').forEach((b) => {
      b.onclick = () => { openReportView(b.dataset.openReport) }
    })
    const searchBtn = document.getElementById('f-search')
    if (searchBtn) searchBtn.onclick = async () => {
      const kw = document.getElementById('f-kw').value.trim()
      if (!kw) { toast('先填话题关键词', true); return }
      const platforms = [...document.querySelectorAll('input[name="plat"]:checked')].map((n) => n.value)
      if (!platforms.length) { toast('至少选一个平台', true); return }
      searchBtn.disabled = true
      const status = document.getElementById('f-status')
      if (status) status.textContent = '搜索中（三平台同步接口，约几秒）…'
      try {
        const r = await apiPost('/api/searches', {
          keyword: kw,
          platforms,
          count: Number(document.getElementById('f-count')?.value) || 50,
          days: Number(document.getElementById('f-days')?.value) || 30,
        })
        const errs = Object.entries(r.search.errors || {})
        if (!r.search.total_items && errs.length) {
          // 平台全挂时不要报「完成 0 条」——那是接口/网络/Key 的问题，不是没话题
          toast(errs.length >= (r.search.platforms || []).length
            ? `搜索失败：${errs[0][1]}`
            : `部分平台失败：${errs.map(([p]) => PLAT[p]?.label || p).join(' / ')}`, true)
        } else {
          toast(`搜索完成：共 ${r.search.total_items} 条${errs.length ? `（${errs.length} 个平台失败）` : ''}`)
        }
        location.hash = `#/s/${encodeURIComponent(r.search.search_id)}`
      } catch (e) {
        toast(e.message, true)
        if (status) status.textContent = ''
      }
      searchBtn.disabled = false
    }
  }

  // ---------- 路由 ----------
  async function render() {
    try { await loadCatalog() } catch {}
    const hash = location.hash || '#/'
    const ms = hash.match(/^#\/s\/(.+)$/)
    const searchId = ms ? decodeURIComponent(ms[1]) : null
    document.querySelectorAll('.nav a').forEach((a) => {
      const cur = searchId ? '' : hash === '#/' ? 'home' : hash.startsWith('#/settings') ? 'settings' : 'home'
      a.classList.toggle('on', a.dataset.view === cur)
    })
    if (searchId && /^[\p{L}\p{N}_-]+$/u.test(searchId)) {
      $app.innerHTML = await viewSearch(searchId)
      bindCommon()
      try {
        const data = await api(`/api/searches/${encodeURIComponent(searchId)}`)
        bindSearch(searchId, data.raw)
      } catch { /* 卡片已在 HTML 中提示错误 */ }
      return
    }
    if (hash.startsWith('#/settings')) { $app.innerHTML = viewSettings(); bindCommon(); bindSettings(); return }
    $app.innerHTML = viewHome()
    bindCommon()
  }

  async function boot() {
    try { await loadCatalog() } catch {
      state.catalog = { version: '-', has_key: false, key_source: 'none', platforms: [], searches: [], settings: {} }
      renderNavCounts()
    }
    render().catch(() => {})
  }
  // 报告 iframe 里的链接点击会 postMessage 过来，统一交给 openLink 走系统浏览器
  addEventListener('message', (e) => {
    if (e.origin !== location.origin) return
    const m = e.data
    if (m && m.type === 'dsh:open-link' && typeof m.url === 'string') openLink(m.url)
  })
  addEventListener('hashchange', () => { state.platform = null; render() })
  boot()
  setTimeout(() => { if (!state.catalog?.version || state.catalog.version === '-') boot() }, 2500)
})()
