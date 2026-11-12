// engine + report 单测：假服务器三平台搜索（翻页/去重/容错）、日期范围、报告与 md 内嵌
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { dateRange, search } from '../lib/engine.js'
import { formatReportHtml, mdToHtml } from '../lib/report.js'
import { PLATFORM_KEYS, InsufficientCreditsError } from '../lib/redfox.js'

test('dateRange：days 偏移正确', () => {
  const now = new Date('2026-11-12T08:00:00')
  const r = dateRange(30, now)
  assert.equal(r.to, '2026-11-12')
  assert.equal(r.from, '2026-10-13')
  const r7 = dateRange(7, now)
  assert.equal(r7.from, '2026-11-05')
})

test('mdToHtml：标题/列表/粗体/链接/转义', () => {
  const html = mdToHtml('# 标题\n\n- 第一条 **加粗**\n- 第二条\n\n看 [知乎](https://zhihu.com) 与 <script>x</script>')
  assert.ok(html.includes('<h2>标题</h2>'))
  assert.ok(html.includes('<ul>'))
  assert.ok(html.includes('<strong>加粗</strong>'))
  assert.ok(html.includes('<a href="https://zhihu.com"'))
  assert.ok(!html.includes('<script>'))
})

test('formatReportHtml：hero/统计卡/面板/研究报告内嵌/无泄漏', () => {
  const data = {
    keyword: 'AI视频工具',
    date_range: { from: '2026-10-13', to: '2026-11-12' },
    total_items: 3,
    platforms: {
      gzh: { platform: 'gzh', label: '公众号', total: 1, items: [{ id: 'GZH1', platform: '公众号', platform_key: 'gzh', title: '深度<文>', desc: '摘要', url: 'https://mp.weixin.qq.com/s/1', author: '号主', author_link: '', author_fans: '--', published_at: '2026-11-01', engagement: { reads: 100000, likes: 5, watches: 1, collects: 0, shares: 3, comments: 0 }, engagement_display: '', cover: '', scores: {} }] },
      xhs: { platform: 'xhs', label: '小红书', total: 2, items: [{ id: 'XHS1', platform: '小红书', platform_key: 'xhs', title: '种草笔记', desc: '', url: 'https://xhslink.com/1', author: '博主', author_link: 'https://xhs.com/u1', author_fans: '5000+', published_at: '2026-11-02', engagement: { likes: 6000, comments: 10, collects: 20, shares: 0, interactions: 0 }, engagement_display: '', cover: '', scores: {} }] },
      dy: { platform: 'dy', label: '抖音', total: 0, items: [], error: '积分不足（3201）' },
    },
  }
  const md = '# 研究发现\n\n**热点A** - 描述，来源 [笔记](https://xhslink.com/1)'
  const html = formatReportHtml(data, { maxItems: 50, reportMd: md })
  assert.ok(html.includes('AI视频工具'))
  assert.ok(html.includes('2026-10-13'))
  assert.ok(html.includes('📝 研究报告'))
  assert.ok(html.includes('<strong>热点A</strong>'))
  assert.ok(html.includes('种草笔记'))
  assert.ok(html.includes('深度&lt;文&gt;'))
  assert.ok(html.includes('积分不足（3201）')) // 平台 error 透出
  assert.ok(html.includes('受小红书风控规则限制')) // xhs 提示
  assert.ok(!html.includes('undefined') && !html.includes('[object Object]'))
  assert.ok(html.includes("data-platform=\"dy\""))
  const noReport = formatReportHtml(data, { maxItems: 50 })
  assert.ok(!noReport.includes('研究报告'))
})

// ── 假服务器：统一接口 + 抖音翻页 ──────────────────────────────────────
test('search：三平台端到端（xhs/gzh 统一、dy 翻页、3201 容错不中断）', async () => {
  let dyPages = 0
  const srv = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const payload = JSON.parse(body || '{}')
      const reply = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
      const wantDy = payload.pageSize !== undefined
      if (!wantDy) {
        // 统一接口：xhs 2 条（一条重复）、gzh 用 dict.articles 包装形态
        reply({
          code: 200,
          data: {
            xhsResult: [
              { workUuid: 'u1', workTitle: '笔记一', workLikedCount: 100 },
              { workUuid: 'u1', workTitle: '重复' },
              { uuid: 'u2', title: '笔记二' },
            ],
            gzhResult: { articles: [{ title: '文章一', url: 'https://mp.weixin.qq.com/s/1', clicksCount: '2.3w' }] },
          },
        })
        return
      }
      dyPages++
      if (dyPages === 1) {
        reply({ code: 200, data: { list: Array.from({ length: 50 }, (_x, i) => ({ content: `视频${i}`, authorName: `dy作者${i}`, opusUrl: `https://dy.com/${i}`, likeCount: i })) } })
      } else if (dyPages === 2) {
        reply({ code: 200, data: { list: Array.from({ length: 3 }, (_x, i) => ({ content: `第二批${i}`, authorName: 'dy作者B', opusUrl: `https://dy.com/b${i}`, likeCount: 9 })) } })
      } else {
        reply({ code: 3201, msg: '积分不足' })
      }
    })
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${srv.address().port}`
  const opts = { apiKey: 'ak_x', apiBase: base }
  try {
    // count=60 → 期望 2 页（50 + 10），第 2 页只有 3 条 < pageSize → 停止，不触发第 3 页
    const data = await search('AI视频', { ...opts, platforms: ['xhs', 'gzh', 'dy'], count: 60, days: 30 })
    assert.equal(data.platforms.xhs.total, 2) // 去重后
    assert.equal(data.platforms.gzh.total, 1)
    assert.equal(data.platforms.dy.total, 53)
    assert.equal(data.total_items, 56)
    assert.ok(!data.platforms.xhs.error)
    assert.ok(!data.platforms.gzh.error)
    assert.equal(dyPages, 2)

    // 只查 dy + 积分不足：不抛出，error 落到平台字段
    const data2 = await search('话题B', { ...opts, platforms: ['dy'], count: 120, days: 7 })
    assert.equal(data2.total_items, 0)
    assert.match(data2.platforms.dy.error, /积分不足/)
    assert.ok(data2.date_range.from < data2.date_range.to)

    // 未知平台在 engine 层被过滤（校验在工具层）→ 返回空结果
    const data3 = await search('x', { ...opts, platforms: ['nope'] })
    assert.equal(data3.total_items, 0)
    assert.deepEqual(Object.keys(data3.platforms), [])
  } finally {
    await new Promise((r) => srv.close(r))
  }
})

test('PLATFORM_KEYS 顺序与常量', () => {
  assert.deepEqual(PLATFORM_KEYS, ['xhs', 'gzh', 'dy'])
  assert.equal(new InsufficientCreditsError('x').name, 'InsufficientCreditsError')
})
