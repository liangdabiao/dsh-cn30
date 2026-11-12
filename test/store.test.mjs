// store + host 工具直调单测：记录生命周期、search→list→report→history 全链路（工具层，离线）
process.env.REDFOX_API_KEY = '' // 清掉环境变量，走 settings
const { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path'
)
const tmp = mkdtempSync(join(tmpdir(), 'dsh-cn30-store-'))
process.env.DSH_HOME = tmp
delete process.env.X_API_KEY

import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

const {
  saveSearch, getMeta, getRaw, listSearches, saveReportMd, saveReportHtml,
  readReportHtml, deleteSearch, getSettings, saveSettings, DATA_DIR,
} = await import('../lib/store.js')
const { formatReportHtml } = await import('../lib/report.js')

test('store：settings / 搜索记录生命周期 / 中文 id 消毒', () => {
  saveSettings({ api_key: 'ak_x' })
  assert.equal(getSettings().api_key, 'ak_x')

  const data = {
    keyword: 'AI视频工具', searched_at: new Date().toISOString(),
    date_range: { from: '2026-10-13', to: '2026-11-12' },
    total_items: 2, count: 50, days: 30,
    platforms: {
      xhs: { platform: 'xhs', label: '小红书', total: 2, items: [{ id: 'XHS1', platform_key: 'xhs', title: 'a', engagement: {}, engagement_display: '', url: 'https://x/1' }, { id: 'XHS2', platform_key: 'xhs', title: 'b', engagement: {}, engagement_display: '', url: 'https://x/2' }] },
      gzh: { platform: 'gzh', label: '公众号', total: 0, items: [] },
      dy: { platform: 'dy', label: '抖音', total: 0, items: [], error: '积分不足' },
    },
  }
  const meta = saveSearch(data)
  assert.ok(meta.search_id.includes('-AI视频工具'))
  assert.equal(DATA_DIR, join(tmp, 'cn30'))
  assert.equal(getMeta(meta.search_id).keyword, 'AI视频工具')
  assert.equal(getRaw(meta.search_id).platforms.xhs.total, 2)
  // 逐平台错误要落盘并出现在公开 meta 里（面板据此区分「接口挂了」和「没搜到」）
  assert.deepEqual(getMeta(meta.search_id).errors, { dy: '积分不足' })
  assert.deepEqual(listSearches()[0].errors, { dy: '积分不足' })
  assert.equal(listSearches().length, 1)
  assert.throws(() => getMeta('../x'), /非法/)

  saveReportMd(meta.search_id, '# 研究报告\n\n**发现** - 内容')
  const htmlFile = saveReportHtml(meta.search_id, '<html>ok</html>')
  assert.ok(existsSync(htmlFile))
  assert.equal(readReportHtml(meta.search_id), htmlFile)
  const pub = listSearches()[0]
  assert.equal(pub.has_report, true)
  assert.equal(pub.has_analysis, true)

  assert.equal(deleteSearch(meta.search_id).ok, true)
  assert.equal(getMeta(meta.search_id), null)
  assert.equal(deleteSearch(meta.search_id).ok, false)
})

// ── 工具直调全链路（假 RedFox）──────────────────────────────────────────
test('host 工具：search→list→report→history + 无 key 引导', async () => {
  const srv = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const payload = JSON.parse(body || '{}')
      const reply = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
      if (payload.pageSize !== undefined) {
        reply({ code: 200, data: { list: [{ content: '抖音视频', authorName: 'dy甲', opusUrl: 'https://dy.com/1', likeCount: 77 }] } })
        return
      }
      if (req.headers['x-api-key'] !== 'ak_tool') {
        reply({ code: 3201, msg: '积分不足' })
        return
      }
      reply({
        code: 200,
        data: {
          xhsResult: [{ workUuid: 'w1', workTitle: '小红书爆款', workLikedCount: '3w', accountNickname: '博主甲', workUrl: 'https://xhs.com/1' }],
          gzhResult: [{ title: '深度稿', url: 'https://mp.weixin.qq.com/s/9', clicksCount: 80000, author: '号主' }],
        },
      })
    })
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  mkdirSync(join(tmp, 'cn30'), { recursive: true })
  writeFileSync(join(tmp, 'cn30', 'settings.json'), JSON.stringify({ api_key: 'ak_tool', api_base: `http://127.0.0.1:${srv.address().port}` }))

  const { cn30SearchTool } = await import('../src/host.js')
  const call = async (args) => {
    try {
      return await cn30SearchTool.execute(args, {})
    } catch (e) {
      return { ok: false, summary: String(e?.message || e) }
    }
  }

  {
    const r = await call({ action: 'search', keyword: 'AI视频' })
    check('search 全平台', r.ok && r.summary.includes('searchId='), r.summary.slice(0, 60))
    check('search 数据速览含三平台', r.data.includes('【公众号】') && r.data.includes('【小红书】') && r.data.includes('【抖音】'), '')
    check('search 页脚（LAW 4）', (r.footer || '').includes('数据源：redfox.hk'), (r.footer || '').slice(0, 60))
    globalThis.__sid = r.summary.match(/searchId=([\p{L}\p{N}-]+)/u)?.[1]
  }
  {
    const r = await call({ action: 'list', platform: 'xhs' })
    check('list 平台过滤', r.ok && r.data.includes('小红书爆款'), '')
    const r2 = await call({ action: 'list', offset: 99 })
    check('list 越界提示', !r2.ok && r2.summary.includes('没有更多'), r2.summary.slice(0, 40))
  }
  {
    const bad = await call({ action: 'list', platform: 'weibo' })
    check('list 非法平台报错', !bad.ok, bad.summary.slice(0, 40))
    const r = await call({ action: 'report', searchId: globalThis.__sid, reportMd: '# 研究发现\n\n**A** - 描述，来源 [笔记](https://xhs.com/1)' })
    check('report 生成内嵌', r.ok && r.summary.includes('研究报告已内嵌') && r.summary.includes('.html'), r.summary.slice(0, 70))
    const html = readFileSync(r.summary.match(/：(.+?\.html)/)?.[1] || '/dev/null', 'utf8')
    assert.ok(html.includes('研究发现'))
    assert.ok(html.includes('小红书爆款'))
  }
  {
    const r = await call({ action: 'history' })
    check('history 列出带标记', r.ok && r.data.includes('有报告') && r.data.includes('有研究'), r.data.split('\n')[0])
  }
  {
    writeFileSync(join(tmp, 'cn30', 'settings.json'), JSON.stringify({}, null, 2))
    const r = await call({ action: 'search', keyword: '无key测试' })
    check('无 key 引导', !r.ok && r.summary.includes('RedFox API Key'), r.summary.slice(0, 50))
    writeFileSync(join(tmp, 'cn30', 'settings.json'), JSON.stringify({ api_key: 'ak_tool', api_base: `http://127.0.0.1:${srv.address().port}` }))
  }
  {
    const bad = await call({ action: 'search', keyword: '' })
    check('search 空关键词报错', !bad.ok, bad.summary.slice(0, 40))
    const r = await call({ action: 'search', keyword: '新话题', platforms: 'xhs,weibo' })
    check('search 非法平台报错', !r.ok && r.summary.includes('未知平台'), r.summary.slice(0, 40))
  }

  await new Promise((r) => srv.close(r))
})

function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  if (!cond) process.exitCode = 1
}

test.after(() => rmSync(tmp, { recursive: true, force: true }))
