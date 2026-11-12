// normalize 单测：中文数量解析/模糊化/三平台归一化/去重（口径对齐上游 cn_last30days.py）
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCount, fuzzyCount, normalizeXhs, normalizeDy, normalizeGzh, dedupeNormalize, fmtEngagement } from '../lib/normalize.js'

test('parseCount：w/万/亿/加号/逗号', () => {
  assert.equal(parseCount('1.2w'), 12000)
  assert.equal(parseCount('5000+'), 5000)
  assert.equal(parseCount('3万'), 30000)
  assert.equal(parseCount('2亿'), 200000000)
  assert.equal(parseCount('1,234'), 1234)
  assert.equal(parseCount(88), 88)
  assert.equal(parseCount(0), 0)
  assert.equal(parseCount(null), 0)
  assert.equal(parseCount(''), 0)
  assert.equal(parseCount('abc'), 0)
})

test('fuzzyCount：<5000 原值，5000+，Nw+', () => {
  assert.equal(fuzzyCount(0), '--')
  assert.equal(fuzzyCount(null), '--')
  assert.equal(fuzzyCount(4999), '4999')
  assert.equal(fuzzyCount(5000), '5000+')
  assert.equal(fuzzyCount(9999), '5000+')
  assert.equal(fuzzyCount(10000), '1w+')
  assert.equal(fuzzyCount('2.5w'), '2w+')
})

test('normalizeXhs：work* 前缀形态 + xsec_token 链接兜底', () => {
  const it = normalizeXhs({
    workId: 'abc123', workTitle: '爆款标题', workDesc: '正文描述',
    accountUserid: 'u1', accountNickname: '作者甲',
    workLikedCount: '1.2w', workCommentsCount: 300, workCollectedCount: '2w', interactiveCount: 50000,
    xsecToken: 'tok', workPublishTime: 1700000000000,
  }, 1)
  assert.equal(it.id, 'XHS1')
  assert.equal(it.platform_key, 'xhs')
  assert.equal(it.url, 'https://www.xiaohongshu.com/explore/abc123?xsec_token=tok')
  assert.equal(it.author_link, 'https://www.xiaohongshu.com/user/profile/u1')
  assert.equal(it.engagement.likes, 12000)
  assert.equal(it.engagement.collects, 20000)
  assert.match(it.published_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  assert.equal(fmtEngagement(it).includes('2w+'), true) // display 由 fmtEngagement 统一生成
})

test('normalizeXhs：id/title 直给形态（二代字段）', () => {
  const it = normalizeXhs({ id: 'n2', title: '新形态', likedCount: 42 }, 2)
  assert.equal(it.id, 'XHS2')
  assert.equal(it.url, 'https://www.xiaohongshu.com/explore/n2')
  assert.equal(it.engagement.likes, 42)
})

test('normalizeDy：广域库形态，粉丝数 --，作者主页按 secUid', () => {
  const it = normalizeDy({
    content: '视频文案', authorName: '作者乙', authorSecUid: 'sec9',
    opusUrl: 'https://www.douyin.com/video/x', likeCount: 8000, commentCount: 120, shareCount: '3w',
  }, 1)
  assert.equal(it.platform_key, 'dy')
  assert.equal(it.author_fans, '--')
  assert.equal(it.author_link, 'https://www.douyin.com/user/sec9')
  assert.equal(it.engagement.likes, 8000)
  assert.equal(it.engagement.shares, 30000)
})

test('normalizeGzh：阅读/在看字段映射', () => {
  const it = normalizeGzh({
    title: '深度文章', url: 'https://mp.weixin.qq.com/s/x', author: '公众号丙',
    clicksCount: 100000, likeCount: 500, watchCount: 88, shareCount: 200,
  }, 1)
  assert.equal(it.platform_key, 'gzh')
  assert.equal(it.engagement.reads, 100000)
  assert.equal(it.engagement.watches, 88)
  assert.equal(fmtEngagement(it).includes('10w+'), true)
})

test('dedupeNormalize：按 workUuid/uuid/videoId/workId/id/noteId 去重并截断 count', () => {
  const arts = [
    { workUuid: 'a', workTitle: '第一条' },
    { workUuid: 'a', workTitle: '重复不收' },
    { uuid: 'b', title: '第二条' },
    { id: 'c', title: '第三条' },
    { title: '无主键保留' },
  ]
  const items = dedupeNormalize(arts, 'xhs', 50)
  assert.equal(items.length, 4)
  assert.equal(items[0].title, '第一条')
  assert.equal(items[3].title, '无主键保留')
  const truncated = dedupeNormalize(arts, 'xhs', 2)
  assert.equal(truncated.length, 2)
})
