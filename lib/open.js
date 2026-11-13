// 宿主侧通用工具（同一份文件被 dsh 家族的各信息源插件共用）：
//   1) openExternal —— 用系统默认浏览器打开链接。桌面端 dsh 的 WebContentsView 把
//      window.open / target=_blank 一律 deny，面板 iframe 里点链接没有任何反应；
//      面板自己开不了浏览器，只能交给宿主进程 spawn 系统打开器（不经过 shell，参数不拼字符串）。
//   2) fetchImage —— 封面图同源代理（可选，需要面板 CSP 或 CDN 防盗链兜底时用）。
import { spawn } from 'node:child_process'

const LOOPBACK = /^(localhost$|127\.\d+\.\d+\.\d+$|0\.0\.0\.0$|::1$|\[::1\]$)/i

export function parseOpenableUrl(raw) {
  let url
  try {
    url = new URL(String(raw || '').trim())
  } catch {
    throw new Error('链接格式不对')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('只支持 http(s) 链接')
  if (LOOPBACK.test(url.hostname)) throw new Error('不支持打开本机地址')
  return url.toString()
}

export function canOpenExternal() {
  if (process.platform === 'win32' || process.platform === 'darwin') return true
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || process.env.WSL_DISTRO_NAME)
}

/** 用系统默认浏览器打开一个 http(s) 链接，resolve 实际打开的 URL。 */
export function openExternal(raw) {
  const target = parseOpenableUrl(raw)
  if (!canOpenExternal()) throw new Error('当前环境没有可用的桌面浏览器')
  const [cmd, args] = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', target]]
    : process.platform === 'darwin'
      ? ['open', [target]]
      : ['xdg-open', [target]]
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true })
    } catch (e) {
      reject(new Error(`打开链接失败：${e.message}`))
      return
    }
    child.once('error', (e) => reject(new Error(`打开链接失败：${e.message}`)))
    child.once('spawn', () => {
      child.unref()
      resolve(target)
    })
  })
}

// ---------------------------------------------------------------------------
// 以下为可选能力：封面图代理（同源返回图片字节，绕开面板 CSP 与 CDN 防盗链）
// ---------------------------------------------------------------------------
const IMAGE_HOSTS = ['rednotecdn.com', 'xhscdn.com', 'xiaohongshu.com', 'kuaishou.com', 'kwimgs.com', 'yximgs.com', 'douyinpic.com', 'douyincdn.com', 'hdslb.com', 'bilibili.com', 'qpic.cn', 'weixin.qq.com']
const IMAGE_CACHE = new Map()
const IMAGE_CACHE_MAX = 80

export function parseImageUrl(raw) {
  let url
  try {
    url = new URL(String(raw || '').trim())
  } catch {
    throw Object.assign(new Error('图片地址格式不对'), { status: 400 })
  }
  if (url.protocol !== 'https:') throw Object.assign(new Error('图片只支持 https'), { status: 400 })
  const host = url.hostname.toLowerCase()
  if (!IMAGE_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))) {
    throw Object.assign(new Error(`不支持的图片域名：${host}`), { status: 400 })
  }
  return url.toString()
}

export async function fetchImage(raw, { timeoutMs = 15000, maxBytes = 8 * 1024 * 1024 } = {}) {
  const url = parseImageUrl(raw)
  const hit = IMAGE_CACHE.get(url)
  if (hit) {
    IMAGE_CACHE.delete(url)
    IMAGE_CACHE.set(url, hit)
    return hit
  }
  const res = await fetch(url, {
    headers: {
      referer: 'https://www.xiaohongshu.com/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
      accept: 'image/avif,image/webp,image/png,image/*,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw Object.assign(new Error(`图片拉取失败 HTTP ${res.status}`), { status: 502 })
  const type = res.headers.get('content-type') || 'image/webp'
  if (!/^image\//i.test(type)) throw Object.assign(new Error('上游返回的不是图片'), { status: 502 })
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > maxBytes) throw Object.assign(new Error('图片过大'), { status: 502 })
  const entry = { type, body: buf, at: Date.now() }
  IMAGE_CACHE.set(url, entry)
  if (IMAGE_CACHE.size > IMAGE_CACHE_MAX) IMAGE_CACHE.delete(IMAGE_CACHE.keys().next().value)
  return entry
}

// ---------------------------------------------------------------------------
// 报告 HTML 外链注入：把报告里的 <a href> 点击转成 postMessage 发回面板，
// 由面板交给 /api/open 用系统浏览器打开（srcdoc iframe 里 target=_blank 是死的）。
// 独立打开（非内嵌）时脚本什么都不做，保持浏览器默认行为。
// ---------------------------------------------------------------------------
export const OPEN_LINK_PATCH = '<script>(function(){'
  + 'document.addEventListener("click",function(e){'
  + 'var a=e.target.closest("a[href]");if(!a)return;'
  + 'var u=a.getAttribute("href")||"";'
  + 'if(!/^https?:/i.test(u))return;'
  + 'if(!(window.parent&&window.parent!==window))return;'
  + 'e.preventDefault();'
  + 'try{window.parent.postMessage({type:"dsh:open-link",url:u},"*");}catch(_){}'
  + '});})();</script>'

export function injectOpenLinks(html) {
  const s = String(html ?? '')
  if (!s || s.includes('dsh:open-link')) return s
  return /<\/body>/i.test(s) ? s.replace(/<\/body>/i, `${OPEN_LINK_PATCH}</body>`) : s + OPEN_LINK_PATCH
}
