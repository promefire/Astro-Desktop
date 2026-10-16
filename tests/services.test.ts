import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServices } from '../src/main/services'
import { ARTICLE_SIZE_LIMIT } from '../src/main/services/paths'
import { parsePublished } from '../src/main/adapters/promefire'
import { parseGitStatus, redactRemote } from '../src/main/services/git'

const execute = promisify(execFile)
let temporary: string
let project: string
let settingsFile: string
const post = 'src/contents/post/中文 文章.md'
const sample = '---\r\ntitle: 错误及解决\r\npublished: 2021-03-06 22:00:05\r\ncategory: 后端学习\r\ntags: [Java, Spring Boot, 项目开发]\r\ncustom: {nested: true}\r\ntop: 3\r\n---\r\n\r\n# 正文\r\n'

async function fixture(at: string): Promise<void> {
  await mkdir(path.join(at, 'src/contents/post'), { recursive: true })
  await mkdir(path.join(at, 'src/contents/drafts'), { recursive: true })
  await mkdir(path.join(at, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(at, 'package.json'), JSON.stringify({ name: 'yukina', dependencies: { astro: '^5.3.0' }, packageManager: 'pnpm@9.14.4', scripts: { dev: 'astro dev', build: 'astro build' } }))
}
const write = async (relative: string, source: string) => { await mkdir(path.dirname(path.join(project, relative)), { recursive: true }); await writeFile(path.join(project, relative), source) }
const runGit = async (...args: string[]) => (await execute('git', ['-C', project, ...args], { windowsHide: true })).stdout

beforeEach(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'astro desktop 测试 '))
  project = path.join(temporary, '中文 博客')
  settingsFile = path.join(temporary, 'app data', 'settings.json')
  await fixture(project)
})
afterEach(async () => {
  const resolved = path.resolve(temporary)
  if (resolved.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(resolved).startsWith('astro desktop 测试 ')) await rm(resolved, { recursive: true, force: true })
})

describe('project connection and persisted settings', () => {
  it('connects a Chinese spaced path and restores recent projects and theme after restart', async () => {
    const services = createServices(settingsFile)
    const connected = await services.projects.select(project)
    expect(connected).toMatchObject({ name: '中文 博客', path: project, adapter: 'promefire-astro-blog', astroVersion: '^5.3.0', packageManager: 'pnpm@9.14.4' })
    expect(connected.git.isRepository).toBe(false)
    expect(connected.warnings.length).toBeGreaterThan(0)
    await services.settings.setTheme('dark')
    const restarted = createServices(settingsFile)
    expect(await restarted.projects.getCurrent()).toBe(null)
    expect(await restarted.settings.get()).toMatchObject({ theme: 'dark', lastProjectPath: project, recentProjects: [{ path: project }] })
    expect((await restarted.projects.openRecent(project)).path).toBe(project)
    expect((await restarted.settings.get()).markdownHtml).toBe(false)
    await restarted.settings.setMarkdownHtml(true)
    expect((await createServices(settingsFile).settings.get()).markdownHtml).toBe(true)
    await restarted.settings.forgetProject(project)
    expect((await restarted.settings.get()).lastProjectPath).toBe(null)
    await expect(restarted.projects.openRecent(project)).rejects.toMatchObject({ code: 'PROJECT_NOT_AUTHORIZED' })
  })

  it('treats a missing html switch as off and does not rewrite the old file', async () => {
    await mkdir(path.dirname(settingsFile), { recursive: true })
    const legacy = JSON.stringify({ version: 1, theme: 'light', recentProjects: [], lastProjectPath: null })
    await writeFile(settingsFile, legacy)
    const services = createServices(settingsFile)
    expect((await services.settings.get()).markdownHtml).toBe(false)
    expect(await readFile(settingsFile, 'utf8')).toBe(legacy)
  })

  it('rejects unknown recent paths without opening them', async () => {
    await expect(createServices(settingsFile).projects.openRecent(project)).rejects.toMatchObject({ code: 'PROJECT_NOT_AUTHORIZED' })
  })

  it('requires only the post directory, keeps optional collections optional, and never executes configs', async () => {
    const services = createServices(settingsFile)
    await write('astro.config.mjs', 'throw new Error("must never run")')
    await expect(services.projects.select(project)).resolves.toMatchObject({ path: project })
    await write('package.json', '{"dependencies":{"react":"19"}}')
    await expect(services.projects.select(project)).rejects.toMatchObject({ code: 'INVALID_PROJECT' })
    await fixture(project)
    // 草稿与 AI 日报目录不是必要条件：项目照常打开，只记警告并报出存在情况。
    await rm(path.join(project, 'src/contents/ai-daily'), { recursive: true })
    await rm(path.join(project, 'src/contents/drafts'), { recursive: true })
    const optional = await services.projects.select(project)
    expect(optional.contentPresence).toEqual({ post: true, draft: false, 'ai-daily': false })
    expect(optional.warnings.some(warning => warning.includes('src/contents/ai-daily'))).toBe(true)
    expect(optional.warnings.some(warning => warning.includes('src/contents/drafts'))).toBe(true)
    // 缺少这两个目录时仍能列出正文，并把缺失的目录单独报出来。
    await write('src/contents/post/只有正文.md', sample)
    const index = await services.content.list()
    expect(index.articles.map(article => article.relativePath)).toEqual(['src/contents/post/只有正文.md'])
    expect(index.issues.map(issue => issue.path).sort()).toEqual(['src/contents/ai-daily', 'src/contents/drafts'])
    // 正文目录仍然是必要条件。
    await rm(path.join(project, 'src/contents/post'), { recursive: true })
    await expect(services.projects.select(project)).rejects.toThrow('src/contents/post')
  })

  it('preserves a malformed settings file and reports failure instead of overwriting it', async () => {
    await mkdir(path.dirname(settingsFile), { recursive: true })
    const broken = '{"version": 1, broken'
    await writeFile(settingsFile, broken)
    const services = createServices(settingsFile)
    await expect(services.settings.get()).rejects.toMatchObject({ code: 'SETTINGS_CORRUPT' })
    await expect(services.settings.setTheme('dark')).rejects.toMatchObject({ code: 'SETTINGS_CORRUPT' })
    await expect(services.projects.select(project)).rejects.toMatchObject({ code: 'SETTINGS_CORRUPT' })
    expect(await readFile(settingsFile, 'utf8')).toBe(broken)
    expect(await services.projects.getCurrent()).toBe(null)
  })

  it('serializes concurrent preferences and leaves no temporary files', async () => {
    const services = createServices(settingsFile)
    await services.projects.select(project)
    await Promise.all([services.settings.setTheme('dark'), services.settings.setTheme('light'), services.settings.setTheme('system')])
    expect((await createServices(settingsFile).settings.get()).theme).toBe('system')
    expect(await readdir(path.dirname(settingsFile))).toEqual(['settings.json'])
  })

  it('keeps ten recent projects and moves reopened ones to the front', async () => {
    const services = createServices(settingsFile)
    for (let n = 0; n < 11; n++) {
      const root = path.join(temporary, `博客 ${n}`)
      await fixture(root)
      await services.projects.select(root)
    }
    let recent = (await services.settings.get()).recentProjects
    expect(recent).toHaveLength(10)
    expect(recent.some((entry) => entry.path === path.join(temporary, '博客 0'))).toBe(false)
    await services.projects.openRecent(path.join(temporary, '博客 3'))
    recent = (await services.settings.get()).recentProjects
    expect(recent[0].path).toBe(path.join(temporary, '博客 3'))
    expect(recent).toHaveLength(10)
  })
})

describe('real filesystem content adapter', () => {
  it('reads title, published, single category, arrays, optional fields, source and revision', async () => {
    await write(post, sample)
    const services = createServices(settingsFile)
    await services.projects.select(project)
    const document = await services.content.read(post)
    expect(document.article).toMatchObject({ title: '错误及解决', published: '2021-03-06T22:00:05', category: '后端学习', tags: ['Java', 'Spring Boot', '项目开发'], draft: null, top: 3, fileStatus: 'unknown', issues: [] })
    expect(document.source).toBe(sample)
    expect(document.body).toBe('\r\n# 正文\r\n')
    expect(document.frontmatter.custom).toEqual({ nested: true })
    expect(document.revision).toMatch(/^[a-f0-9]{64}$/)
    await write(post, sample + '外部修改')
    expect((await services.content.read(post)).revision).not.toBe(document.revision)
  })

  it('recurses into nested MDX as text and keeps daily draft semantics separate', async () => {
    const mdx = '\uFEFF---\ntitle: Agent-Embabel框架\npublished: 2026-08-14 15:08:14\ncategory: 后端学习\ntags: [Agent, Spring]\ndraft: true\n---\nimport {danger} from "do-not-execute"\n<Component />'
    await write('src/contents/post/学习 文档/Embabel.mdx', mdx)
    await write('src/contents/ai-daily/2026/2026-10-08.md', '---\ntitle: "AI 日报 · 2026-10-08"\npublished: 2026-10-08\nsummary: 今日更新\nhighlights: [新闻一]\ntools: [Codex]\ntags: [AI]\ndraft: true\n---\n# 日报')
    await write('src/contents/ai-daily/ignored.mdx', mdx)
    await write('src/contents/post/image.png', 'not markdown')
    const services = createServices(settingsFile)
    await services.projects.select(project)
    const index = await services.content.list()
    expect(index.articles).toHaveLength(2)
    expect(index.issues).toEqual([])
    expect(index.articles.find((a) => a.kind === 'post')).toMatchObject({ draft: true, extension: '.mdx', title: 'Agent-Embabel框架' })
    expect(index.articles.find((a) => a.kind === 'ai-daily')).toMatchObject({ draft: null, published: '2026-10-08', summary: '今日更新', highlights: ['新闻一'], tools: ['Codex'] })
    expect(index.articles.find((a) => a.kind === 'ai-daily')!.issues[0]).toContain('不支持 draft')
    expect((await services.content.read('src/contents/post/学习 文档/Embabel.mdx')).source).toBe(mdx)
  })

  it('isolates invalid YAML, missing delimiters, and unsafe alias cycles', async () => {
    await write(post, sample)
    await write('src/contents/post/bad.md', '---\ntitle: [unterminated\n---\nbody')
    await write('src/contents/post/no-frontmatter.md', '# plain body')
    await write('src/contents/post/cycle.md', '---\nloop: &loop [*loop]\n---\nbody')
    const services = createServices(settingsFile)
    await services.projects.select(project)
    const index = await services.content.list()
    expect(index.articles.map((a) => a.title)).toEqual(['错误及解决'])
    expect(index.issues).toHaveLength(3)
  })

  it('does not coerce invalid field types or silently use Hexo date fields', async () => {
    await write(post, '---\ntitle: 12\ndate: 2026-10-09\ncategory: [a,b]\ntags: [good, 1]\ndraft: "true"\ntop: true\n---\nbody')
    const services = createServices(settingsFile)
    await services.projects.select(project)
    const { article, frontmatter } = await services.content.read(post)
    expect(article).toMatchObject({ title: '中文 文章', published: null, category: null, tags: [], draft: null, top: null })
    expect(article.issues).toHaveLength(6)
    expect(frontmatter).toMatchObject({ title: 12, draft: 'true', top: true, date: '2026-10-09' })
  })

  it('reports required daily summary and defaults optional arrays', async () => {
    await write('src/contents/ai-daily/daily.md', '---\ntitle: 日报\npublished: 2026-10-09\n---\nbody')
    const services = createServices(settingsFile)
    await services.projects.select(project)
    const { article } = await services.content.read('src/contents/ai-daily/daily.md')
    expect(article).toMatchObject({ tags: [], highlights: [], tools: [], draft: null, issues: ['summary 必须是非空字符串'] })
  })

  it('blocks traversal, absolute paths, other files and oversized content', async () => {
    await write(post, sample)
    await write('src/contents/post/large.md', 'x'.repeat(ARTICLE_SIZE_LIMIT + 1))
    const services = createServices(settingsFile)
    await services.projects.select(project)
    for (const relative of ['../secret.md', 'src/contents/post/../../secret.md', 'C:\\Windows\\system.ini', '/etc/passwd', 'src/contents/post/./secret.md', 'src/contents/post/x.md:secret']) {
      await expect(services.content.read(relative)).rejects.toMatchObject({ code: 'INVALID_PATH' })
    }
    await expect(services.content.read('package.json')).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    await expect(services.content.resolveArticlePath('src/contents/ai-daily/ignored.mdx')).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    await expect(services.content.read('src/contents/post/large.md')).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
    expect((await services.content.list()).articles).toHaveLength(1)
    expect(await services.content.resolveArticlePath(post)).toBe(path.join(project, post))
  })

  it('blocks directory junction escape on Windows and symlink escape elsewhere', async () => {
    const outside = path.join(temporary, 'outside')
    await mkdir(outside)
    await writeFile(path.join(outside, 'secret.md'), sample)
    await symlink(outside, path.join(project, 'src/contents/post/escape'), process.platform === 'win32' ? 'junction' : 'dir')
    const services = createServices(settingsFile)
    await services.projects.select(project)
    await expect(services.content.read('src/contents/post/escape/secret.md')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_PROJECT' })
    const index = await services.content.list()
    expect(index.articles).toEqual([])
    expect(index.issues[0].message).toContain('项目目录之外')
  })

  it('reports no-project errors before access and returns clones of project state', async () => {
    const services = createServices(settingsFile)
    await expect(services.content.list()).rejects.toMatchObject({ code: 'NO_PROJECT' })
    const info = await services.projects.select(project)
    info.path = 'tampered'
    expect((await services.projects.getCurrent())!.path).toBe(project)
  })
})

describe('date and Git behavior', () => {
  it('normalizes actual single-digit dates without shifting calendar dates or offsets', () => {
    expect(parsePublished('2025-08-1 15:08:14')).toBe('2025-08-01T15:08:14')
    expect(parsePublished('2026-10-09')).toBe('2026-10-09')
    expect(parsePublished('2026-10-09T00:30:00+08:00')).toBe('2026-10-09T00:30:00+08:00')
    expect(parsePublished('2024-2-29')).toBe('2024-02-29')
    for (const value of ['2025-02-29', '2026-13-01', '2026-04-31', '2026-01-01 25:00:00', true, 20260101]) expect(parsePublished(value)).toBe(null)
  })

  it('maps porcelain NUL records including renamed files and conflicts', () => {
    const result = parseGitStatus(' M src/contents/post/中文 空格.md\0R  src/contents/post/new.md\0src/contents/post/old.md\0?? src/contents/post/newer.md\0UU src/contents/post/conflict.md\0!! src/contents/post/ignored.md\0')
    expect([...result]).toEqual([['src/contents/post/中文 空格.md', 'modified'], ['src/contents/post/new.md', 'modified'], ['src/contents/post/newer.md', 'untracked'], ['src/contents/post/conflict.md', 'conflict'], ['src/contents/post/ignored.md', 'ignored']])
  })

  it('redacts HTTP credentials and query tokens while preserving SSH repository addresses', () => {
    expect(redactRemote('https://user:secret@github.com/promefire/Astro_Blog.git?token=secret')).toBe('https://redacted@github.com/promefire/Astro_Blog.git')
    expect(redactRemote('git@github.com:promefire/Astro_Blog.git')).toBe('git@github.com:promefire/Astro_Blog.git')
  })

  it('reads actual Git branch and file state without changing the repository', async () => {
    await write(post, sample)
    await runGit('init', '-b', 'main')
    await runGit('add', '.')
    await runGit('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture')
    await runGit('remote', 'add', 'origin', 'https://user:secret@github.com/promefire/Astro_Blog.git')
    const services = createServices(settingsFile)
    const info = await services.projects.select(project)
    expect(info.git).toMatchObject({ isRepository: true, branch: 'main', remote: 'https://redacted@github.com/promefire/Astro_Blog.git' })
    expect((await services.content.read(post)).article.fileStatus).toBe('clean')
    await write(post, sample + 'modified')
    await write('src/contents/post/new.md', sample)
    await write('src/contents/post/added.md', sample)
    await runGit('add', 'src/contents/post/added.md')
    const before = await runGit('status', '--porcelain=v1', '-z')
    const index = await services.content.list()
    expect(index.articles.find((a) => a.relativePath === post)!.fileStatus).toBe('modified')
    expect(index.articles.find((a) => a.relativePath.endsWith('/new.md'))!.fileStatus).toBe('untracked')
    expect(index.articles.find((a) => a.relativePath.endsWith('/added.md'))!.fileStatus).toBe('added')
    expect(await runGit('status', '--porcelain=v1', '-z')).toBe(before)
  })

  it('inherits ignored-directory state and disables repository fsmonitor commands', async () => {
    await runGit('init', '-b', 'main')
    await write('.gitignore', 'src/contents/post/private/\n')
    await write('src/contents/post/private/ignored.md', sample)
    await write(post, sample)
    await runGit('config', 'core.fsmonitor', 'this-command-must-never-run')
    const services = createServices(settingsFile)
    const info = await services.projects.select(project)
    expect(info.git.error).toBe(null)
    const index = await services.content.list()
    expect(index.articles.find((article) => article.relativePath.endsWith('/ignored.md'))!.fileStatus).toBe('ignored')
    expect(index.articles.find((article) => article.relativePath === post)!.fileStatus).toBe('untracked')
  })
})
