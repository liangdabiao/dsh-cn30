// 技能快照提供方（cn-last30days：中国社媒话题研究方法论）。
// 与 stock-research 同款：解析 SKILL.md frontmatter，get 时追加 DSH 环境说明。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const RANK = 600
const INVOCATION = { modelInvocable: true, userInvocable: true }

function parse(file) {
  const text = readFileSync(file, 'utf8')
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return null
  const block = m[1]
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim()
  const descM = block.match(/^description:\s*(.+)$/m)?.[1]
  let description = descM ? descM.trim().replace(/^(["'])(.*)\1$/, '$2') : null
  if (!description) {
    const lines = block.split(/\r?\n/)
    const start = lines.findIndex((l) => /^description:\s*>/.test(l))
    if (start !== -1) {
      const collected = []
      for (let i = start + 1; i < lines.length; i++) {
        if (/^\S/.test(lines[i])) break
        collected.push(lines[i].replace(/^\s+/, ''))
      }
      description = collected.join(' ').trim()
    }
  }
  if (!name || !description) return null
  return { name, description, body: text.slice(m[0].length) }
}

function readDir(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const sDir = join(dir, entry.name)
    const skillFile = join(sDir, 'SKILL.md')
    if (!existsSync(skillFile)) continue
    const parsed = parse(skillFile)
    if (!parsed) continue
    const auxFiles = readdirSync(sDir).filter((f) => f.endsWith('.md') && f !== 'SKILL.md')
    out.push({ dir: sDir, file: skillFile, ...parsed, dirName: entry.name, auxFiles })
  }
  return out
}

function addendum(skill) {
  return [
    '',
    '---',
    '',
    '## 在 DSH 插件里使用',
    '',
    `- 本技能目录：\`${skill.dir}\`；附属 .md 文件用文件读取工具按需加载。`,
    '- cn30_search 工具负责搜索/持久化/HTML 报告；话题综合研究与输出由你完成（按 cn-last30days 技能的 LAW 规则）。',
    '- 研究报告写完必须 report 存档内嵌 HTML，再按 LAW 规则把发现输出给用户。',
    '',
  ].join('\n')
}

export function createSkillProvider(dirs) {
  const list = [].concat(dirs)
  const candidate = (s, auxFiles) => ({
    name: s.name,
    description: s.description,
    path: s.file,
    invocation: INVOCATION,
    source: 'bundled',
    provider: "cn30",
    rank: RANK,
    locator: s.dir,
    resourceBase: { kind: 'directory', path: s.dir },
    auxFiles,
  })

  return {
    name: "cn30",
    async list() {
      return list.flatMap(readDir).map((s) => {
        const c = candidate(s, s.auxFiles)
        const { auxFiles, ...rest } = c
        return rest
      })
    },
    async get(c) {
      const s = list.flatMap(readDir).find((x) => x.dir === c.locator && x.name === c.name)
      if (!s) return undefined
      const content = s.body + addendum(s)
      const { rank, locator, auxFiles, ...summary } = candidate(s, s.auxFiles)
      return { ...summary, content, auxFiles }
    },
  }
}

export { readDir, addendum }
