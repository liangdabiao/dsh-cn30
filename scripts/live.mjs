// 真实网络冒烟：搜索一个小话题（三平台 20 条/平台），打印成功率与样例，生成纯数据版 HTML。
//   DSH_HOME=<目录> node scripts/live.mjs [关键词] [ak_xxx]
// key 优先级：命令行第二参 > 数据目录 settings.json > 环境变量 REDFOX_API_KEY。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [, , kwArg, keyArg] = process.argv
const keyword = kwArg || 'AI视频工具'
const home = process.env.DSH_HOME || join(process.env.HOME || process.env.USERPROFILE, '.dsh')

if (keyArg) {
  mkdirSync(join(home, 'cn30'), { recursive: true })
  writeFileSync(join(home, 'cn30', 'settings.json'), JSON.stringify({ api_key: keyArg }, null, 2))
  console.log('API key 已写入 settings.json')
}
const { getSettings } = await import('../lib/store.js')
if (!getSettings().api_key && !process.env.REDFOX_API_KEY && !process.env.X_API_KEY) {
  console.error('缺少 RedFox API Key：node scripts/live.mjs <关键词> ak_xxx')
  process.exit(1)
}

const { cn30SearchTool } = await import('../src/host.js')
const call = (args) => cn30SearchTool.execute(args, {})

console.log(`真实搜索：「${keyword}」 三平台 × 20 条`)
const t0 = Date.now()
const r = await call({ action: 'search', keyword, count: 20, days: 30 })
console.log(`\n[${Math.round((Date.now() - t0) / 1000)}s] ${r.summary}`)
if (r.data) console.log(r.data.split('\n').slice(0, 12).join('\n') + '\n…')
console.log(`\n页脚: ${r.footer || '—'}`)

if (r.ok) {
  const sid = r.summary.match(/searchId=([\p{L}\p{N}-]+)/u)?.[1]
  const rep = await call({ action: 'report', searchId: sid })
  console.log(`\n${rep.summary}`)
}
