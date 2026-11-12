// 冒烟测试（离线）：假 RedFox 服务器 + 工具直调全链路 + 面板 API 全路由。
// 运行：npm run smoke
const { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const http = await import('node:http')

const tmp = mkdtempSync(join(tmpdir(), 'dsh-cn30-smoke-'))
process.env.DSH_HOME = tmp
delete process.env.REDFOX_API_KEY
delete process.env.X_API_KEY

let failed = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  if (!cond) failed++
}

// ── 假 RedFox：统一接口 + 抖音广域库（xhs 2 条 / gzh dict 包装 3 条 / dy 1 页 55 条限 50）──
const XHS = [
  { workUuid: 'x1', workTitle: '爆款种草笔记', workDesc: '真实使用体验分享', accountNickname: '博主甲', accountUserid: 'u1', workLikedCount: '2.5w', workCommentsCount: 320, workCollectedCount: '1.8w', workUrl: 'https://www.xiaohongshu.com/explore/x1', workPublishTime: 1700000000000 },
  { uuid: 'x2', title: '攻略帖', likedCount: 4200, commentCount: 88, collectCount: 900, id: 'x2' },
]
const GZH = [
  { title: '行业深度：AI视频元年', url: 'https://mp.weixin.qq.com/s/a', author: '科技号', clicksCount: '10w+', likeCount: 1200, shareCount: 800 },
  { title: '观点稿 B', url: 'https://mp.weixin.qq.com/s/b', author: '观察号', clicksCount: 42000, likeCount: 300, shareCount: 150 },
  { title: '数据报告 C', url: 'https://mp.weixin.qq.com/s/c', author: '研究所', clicksCount: 8000, likeCount: 90, shareCount: 40 },
]
const srv = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const payload = JSON.parse(body || '{}')
    const reply = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.headers['x-api-key'] !== 'ak_smoke') return reply({ code: 401, msg: 'bad key' })
    if (payload.pageSize !== undefined) {
      const n = Math.min(55, payload.pageSize)
      reply({ code: 200, data: { list: Array.from({ length: n }, (_x, i) => ({ content: `抖音热评视频 ${payload.pageNum}-${i} 关于AI视频工具的讨论`, authorName: `dy作者${i}`, authorSecUid: `sec${i}`, opusUrl: `https://www.douyin.com/video/${payload.pageNum}_${i}`, likeCount: 9000 + i, commentCount: 100 + i, shareCount: 50 })) } })
      return
    }
    reply({ code: 200, data: { xhsResult: XHS, gzhResult: { articles: GZH } } })
  })
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
mkdirSync(join(tmp, 'cn30'), { recursive: true })
writeFileSync(join(tmp, 'cn30', 'settings.json'), JSON.stringify({ api_key: 'ak_smoke', api_base: `http://127.0.0.1:${srv.address().port}` }))

// ── 工具直调 ──
const { cn30SearchTool } = await import('../src/host.js')
const call = async (args) => {
  try { return await cn30SearchTool.execute(args, {}) } catch (e) { return { ok: false, summary: String(e?.message || e) } }
}
let sid
{
  const r = await call({ action: 'search', keyword: 'AI视频工具', count: 20, days: 30 })
  check('search 启动并入库', r.ok && r.summary.includes('searchId='), r.summary.slice(0, 50))
  sid = r.summary.match(/searchId=([\p{L}\p{N}-]+)/u)?.[1]
  check('search 统计行', r.data.includes('小红书】2 条') && r.data.includes('公众号】3 条'), (r.data || '').split('\n').slice(1).join(' '))
  check('search 条目带标题与链接', r.data.includes('《爆款种草笔记》') && r.data.includes('xiaohongshu.com'), '')
  check('search 页脚含日期范围', (r.footer || '').includes('数据源') && (r.footer || '').includes(sid), (r.footer || '').slice(0, 80))
}
{
  const r = await call({ action: 'list', searchId: sid, platform: 'dy', limit: 5 })
  check('list dy 过滤+截断', r.ok && r.data.includes('《抖音热评视频') && r.data.split('DY').length === 6, r.summary.slice(0, 40))
  const r2 = await call({ action: 'list', searchId: sid, withDesc: 'true', limit: 1 })
  check('list withDesc 带摘要', r2.ok && r2.data.includes('真实使用体验'), '')
}
{
  const md = '# AI视频工具 · 三平台研究\n\n**公众号先行定调** - 深度稿定义了话题框架，来源 [科技号](https://mp.weixin.qq.com/s/a)\n\n**小红书种草跟进** - 真实体验帖收藏比高，来源 [博主甲](https://www.xiaohongshu.com/explore/x1)\n\n核心发现：\n1. 深度内容先出，种草内容跟进 - 来源 [科技号](https://mp.weixin.qq.com/s/a)\n2. 收藏/点赞比高企显示强种草信号 - 来源 [博主甲](https://www.xiaohongshu.com/explore/x1)'
  const r = await call({ action: 'report', searchId: sid, reportMd: md })
  check('report 内嵌生成', r.ok && r.summary.includes('研究报告已内嵌'), r.summary.slice(0, 60))
  const file = r.summary.match(/：(.+?\.html)/)?.[1]
  check('report 落盘', file && existsSync(file), file || '')
  const html = file ? readFileSync(file, 'utf8') : ''
  check('HTML 关键元素', html.includes('AI视频工具 · 三平台研究') && html.includes('爆款种草笔记') && html.includes('panel-dy'), '')
  check('HTML 无泄漏', !html.includes('undefined') && !html.includes('[object Object]'), '')
}
{
  const r = await call({ action: 'history' })
  check('history 有报告标记', r.ok && r.data.includes('有报告') && r.data.includes('有研究'), r.data.split('\n')[0] || '')
}

// ── 面板 API ──
const { registerApi } = await import('../lib/api.js')
const { readReportHtml } = await import('../lib/store.js')
const { Writable } = await import('node:stream')
const { EventEmitter } = await import('node:events')
const routes = {}
registerApi({ get: () => undefined, webServer: { register: (r) => { routes[r.path] = r.handler } } }, { config: {} })
const req = async (method, path, body) => {
  const reqObj = new EventEmitter()
  reqObj.method = method
  reqObj.url = `/cn30${path}`
  reqObj.headers = body ? { 'content-type': 'application/json', host: 'x', origin: 'http://x' } : { host: 'x' }
  const chunks = []
  const resObj = new Writable({ write(c, _e, cb) { chunks.push(c); cb() } })
  resObj.statusCode = 0
  resObj.writeHead = (code) => { resObj.statusCode = code }
  const done = new Promise((resolve) => {
    const origEnd = resObj.end.bind(resObj)
    resObj.end = (...args) => { origEnd(...args); resolve({ status: resObj.statusCode, json: (() => { try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return null } })() }) }
  })
  const p = routes['/cn30'](reqObj, resObj)
  if (body) reqObj.emit('data', Buffer.from(JSON.stringify(body)))
  reqObj.emit('end')
  await p
  return done
}
{
  const cat = await req('GET', '/api/catalog')
  check('catalog：key/平台/历史', cat.status === 200 && cat.json.has_key && cat.json.platforms.length === 3 && cat.json.searches.length >= 1, '')
  const one = await req('GET', `/api/searches/${sid}`)
  check('search 详情带 raw', one.status === 200 && one.json.raw?.platforms?.xhs?.items?.length === 2, '')
  const rawReport = await req('POST', `/api/searches/${sid}/report`)
  check('面板直出纯数据报告', rawReport.status === 200 && rawReport.json.ok, '')
  // analysis-md 通道（面板未来接 agent 回写）
  const mdOk = await req('POST', `/api/searches/${sid}/analysis-md`, { md: '# 面板回写\n\n**发现** - 内容' })
  check('analysis-md 回写', mdOk.status === 200 && mdOk.json.ok, '')
  const mdHtml = readFileSync(readReportHtml(sid), 'utf8')
  check('回写后报告含新研究', mdHtml.includes('面板回写'), '')
}
{
  const created = await req('POST', '/api/searches', { keyword: '面板直搜', platforms: ['xhs'], count: 20, days: 7 })
  check('面板直搜', created.status === 200 && created.json.ok && created.json.search.total_items === 2, `total=${created.json?.search?.total_items}`)
  const badKw = await req('POST', '/api/searches', { keyword: '' })
  check('空关键词 400', badKw.status === 400, '')
  const del = await req('DELETE', `/api/searches/${created.json.search.search_id}`)
  check('面板删记录', del.status === 200 && del.json.ok, '')
}
{
  const st = await req('GET', '/api/settings')
  check('settings GET 尾号', st.status === 200 && st.json.settings.has_key && st.json.settings.key_tail.length === 6, String(st.json.settings.key_tail))
  const bad = await req('POST', '/api/settings', { api_key: 'no-prefix' })
  check('settings 非 ak_ 拒绝', bad.status === 400, '')
}
{
  const idx = readFileSync(new URL('../lab/index.html', import.meta.url), 'utf8')
  check('lab 引用 scheme/app', idx.includes('app.js') && idx.includes('scheme.js'), '')
  const appjs = readFileSync(new URL('../lab/app.js', import.meta.url), 'utf8')
  check('lab 消息类型与 client 对齐', appjs.includes('cn30:refresh') && appjs.includes('cn30:start-ok'), '')
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  check('client 消息类型一致', client.includes('cn30:refresh') && client.includes('cn30:start-ok'), '')
}

srv.close()
rmSync(tmp, { recursive: true, force: true })
console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
