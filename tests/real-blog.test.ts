import { expect, it } from 'vitest'
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { MISSING_DRAFTS_MESSAGE } from '../src/main/adapters/promefire'
import { createServices } from '../src/main/services'

const blog = process.env.ASTRO_BLOG_TEST_PATH

it.skipIf(!blog)('reads an explicitly supplied real Astro_Blog checkout without changing its Git state', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'astro-real-blog-check-'))
  const execute = promisify(execFile)
  const status = async () => (await execute('git', ['-c', 'core.fsmonitor=false', '-C', blog!, 'status', '--porcelain=v1', '-z'], { windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })).stdout
  try {
    const before = await status()
    const services = createServices(path.join(temporary, 'settings.json'))
    const project = await services.projects.select(blog!)
    const index = await services.content.list()
    expect(project.adapter).toBe('promefire-astro-blog')
    let draftsExist = true
    try { await stat(path.join(blog!, 'src/contents/drafts')) } catch { draftsExist = false }
    expect(index.issues).toEqual(draftsExist ? [] : [{ path: 'src/contents/drafts', message: MISSING_DRAFTS_MESSAGE }])
    expect(index.articles.filter((article) => article.kind === 'post').length).toBeGreaterThan(0)
    expect(index.articles.filter((article) => article.kind === 'ai-daily').length).toBeGreaterThan(0)
    expect(index.articles.every((article) => article.published !== null)).toBe(true)
    for (const article of index.articles) {
      const document = await services.content.read(article.relativePath)
      expect(document.source).toBe(await readFile(path.join(project.path, article.relativePath), 'utf8'))
      expect(document.article.issues).toEqual([])
    }
    expect(await status()).toBe(before)
    console.info(`Real Astro_Blog: ${index.articles.filter((article) => article.kind === 'post').length} posts, ${index.articles.filter((article) => article.kind === 'ai-daily').length} AI daily articles; ${index.issues.length} scan issues; Git status unchanged.`)
  } finally {
    const resolved = path.resolve(temporary)
    if (resolved.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(resolved).startsWith('astro-real-blog-check-')) await rm(resolved, { recursive: true, force: true })
  }
}, 30000)
