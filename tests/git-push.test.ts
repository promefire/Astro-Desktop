import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createServices } from '../src/main/services'

const execute = promisify(execFile)
const git = (at: string, ...args: string[]) => execute('git', ['-C', at, ...args], { windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).then(result => result.stdout.trimEnd())
const bare = (repository: string, ...args: string[]) => execute('git', ['--git-dir', repository, '-c', 'core.quotepath=false', ...args], { windowsHide: true }).then(result => result.stdout.trimEnd())

const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false']
const post = 'src/contents/post/文章.md'
const daily = 'src/contents/ai-daily/2026-02-03.md'
const article = '---\ntitle: 文章\npublished: 2026-02-03\ntags: [Astro]\n---\n\n正文\n'
const dailyArticle = '---\ntitle: 日报\npublished: 2026-02-03\nsummary: 摘要\n---\n\n日报\n'

let temporary: string
let project: string
let bareRepository: string
let settingsFile: string
let services: ReturnType<typeof createServices>

/** A blog repository with a local bare repository as its origin; nothing here touches a real remote. */
async function blog(at: string, origin: string) {
  await mkdir(path.join(at, 'src/contents/post'), { recursive: true })
  await mkdir(path.join(at, 'src/contents/ai-daily'), { recursive: true })
  await writeFile(path.join(at, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
  await writeFile(path.join(at, post), article)
  await writeFile(path.join(at, daily), dailyArticle)
  await git(at, 'init', '-b', 'main')
  await git(at, 'config', 'user.name', 'Test')
  await git(at, 'config', 'user.email', 'test@example.invalid')
  await git(at, 'config', 'commit.gpgsign', 'false')
  await git(at, 'add', '.')
  await git(at, 'commit', '-m', 'fixture')
  await git(at, 'remote', 'add', 'origin', origin)
  await git(at, 'push', 'origin', 'main')
}

/** A second clone plays the server that commits AI reports on its own. */
async function serverCommitsDaily(file: string, text: string) {
  const machine = path.join(temporary, '另一台电脑')
  await execute('git', ['clone', '-q', bareRepository, machine], { windowsHide: true })
  await git(machine, 'config', 'user.name', 'Server')
  await git(machine, 'config', 'user.email', 'server@example.invalid')
  await mkdir(path.dirname(path.join(machine, file)), { recursive: true })
  await writeFile(path.join(machine, file), text)
  await git(machine, 'add', '.')
  await git(machine, 'commit', '-m', '服务器日报')
  await git(machine, 'push', 'origin', 'main')
  return machine
}

beforeEach(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'astro-push-test-'))
  project = path.join(temporary, '中文 博客')
  bareRepository = path.join(temporary, 'origin.git')
  settingsFile = path.join(temporary, 'app data', 'settings.json')
  await execute('git', ['init', '--bare', '-q', '-b', 'main', bareRepository], { windowsHide: true })
  await blog(project, bareRepository)
  services = createServices(settingsFile)
  await services.projects.select(project)
})
afterEach(async () => {
  const target = path.resolve(temporary)
  if (target.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(target).startsWith('astro-push-test-')) await rm(target, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
})

describe('pulling the remote and pushing local changes', () => {
  it('merges the server commit first, then commits and pushes the working tree', async () => {
    await serverCommitsDaily('src/contents/ai-daily/2026-02-04.md', dailyArticle.replace('2026-02-03', '2026-02-04'))
    await writeFile(path.join(project, post), `${article}\n本地新增段落。\n`)
    const snapshot = await services.content.pullRemote({ projectPath: project })
    expect(snapshot.branch).toBe('main')
    expect(snapshot.remote).toBe('origin')
    expect(snapshot.behind).toBe(0)
    expect(snapshot.changes.map(change => change.path)).toContain(post)
    expect(snapshot.changes.find(change => change.path === post)?.status).toBe('modified')
    // 拉取把服务器提交带到了本地，但工作区的本地修改没有被覆盖。
    expect(await readFile(path.join(project, 'src/contents/ai-daily/2026-02-04.md'), 'utf8')).toContain('日报')
    expect(await readFile(path.join(project, post), 'utf8')).toContain('本地新增段落')

    const pushed = await services.content.pushChanges({ projectPath: project, message: '更新文章' })
    expect(pushed.branch).toBe('main')
    expect(pushed.commit).toMatch(/^[0-9a-f]{7,}$/)
    expect(await bare(bareRepository, 'log', '--format=%s', '-1')).toBe('更新文章')
    expect(await bare(bareRepository, 'log', '--format=%s', '--all')).toContain('服务器日报')
    const pushedFiles = await bare(bareRepository, 'show', '--name-only', '--format=', 'HEAD')
    expect(pushedFiles).toContain(post)
    // 服务器日报没有被本地提交覆盖或删除。
    expect(await bare(bareRepository, 'ls-tree', '-r', '--name-only', 'HEAD')).toContain('src/contents/ai-daily/2026-02-04.md')
  })

  it('reports new files, deletions and untracked files before pushing', async () => {
    await writeFile(path.join(project, post), article.replace('正文', '改过的正文'))
    await writeFile(path.join(project, 'src/contents/post/新文章.md'), article.replace('文章', '新文章'))
    await mkdir(path.join(project, 'src/contents/drafts'), { recursive: true })
    await writeFile(path.join(project, 'src/contents/drafts/草稿.md'), article)
    await rm(path.join(project, daily))
    const snapshot = await services.content.pullRemote({ projectPath: project })
    const status = new Map(snapshot.changes.map(change => [change.path, change.status]))
    expect(status.get(post)).toBe('modified')
    expect(status.get('src/contents/post/新文章.md')).toBe('untracked')
    expect(status.get('src/contents/drafts/草稿.md')).toBe('untracked')
    // 删除的目录在 Git 里表现为删除文件，不是「已修改」。
    expect(snapshot.changes.some(change => change.status === 'deleted')).toBe(true)
    const pushed = await services.content.pushChanges({ projectPath: project, message: '整理内容' })
    expect(pushed.commit).toBeTruthy()
    expect(await bare(bareRepository, 'ls-tree', '-r', '--name-only', 'HEAD')).not.toContain(daily)
  })

  it('pushes existing local commits without creating an empty commit', async () => {
    await writeFile(path.join(project, post), `${article}\n已提交的内容。\n`)
    await git(project, 'add', '.')
    await git(project, ...identity, 'commit', '-m', '本地提交')
    const snapshot = await services.content.pullRemote({ projectPath: project })
    expect(snapshot.changes).toEqual([])
    expect(snapshot.ahead).toBe(1)
    const pushed = await services.content.pushChanges({ projectPath: project, message: '不应该被使用' })
    expect(pushed.commit).toBe(null)
    expect(await bare(bareRepository, 'log', '--format=%s', '-1')).toBe('本地提交')
  })

  it('requires a commit message and refuses to push when there is nothing to do', async () => {
    await writeFile(path.join(project, post), `${article}\n改动。\n`)
    await expect(services.content.pushChanges({ projectPath: project, message: '   ' })).rejects.toThrow(/请先填写提交信息/)
    await expect(services.content.pushChanges({ projectPath: project, message: 'x'.repeat(201) })).rejects.toThrow(/最多 200/)
    await expect(services.content.pushChanges({ projectPath: project, message: 'ok', extra: true })).rejects.toThrow(/只接受当前项目/)
    await expect(services.content.pushChanges({ projectPath: path.join(temporary, '别的博客'), message: 'ok' })).rejects.toThrow(/当前项目已切换/)
    await git(project, 'add', '.')
    await git(project, ...identity, 'commit', '-m', '先提交')
    await git(project, 'push', 'origin', 'main')
    await expect(services.content.pushChanges({ projectPath: project, message: '没有改动' })).rejects.toThrow(/没有需要提交或推送的修改/)
  })

  it('stops on a merge conflict instead of committing conflict markers', async () => {
    const server = await serverCommitsDaily(post, `${article}\n服务器版本。\n`)
    expect(server).toContain('另一台电脑')
    await writeFile(path.join(project, post), `${article}\n本地版本。\n`)
    await git(project, 'add', '.')
    await git(project, ...identity, 'commit', '-m', '本地修改')
    await expect(services.content.pullRemote({ projectPath: project })).rejects.toThrow(/拉取失败/)
    expect(await git(project, 'status', '--porcelain=v1')).toContain('UU')
    await expect(services.content.pushChanges({ projectPath: project, message: '不该成功' })).rejects.toThrow(/未解决的合并冲突/)
    expect(await bare(bareRepository, 'log', '--format=%s', '-1')).toBe('服务器日报')
  })

  it('reports a missing repository or remote instead of failing silently', async () => {
    const plain = path.join(temporary, '没有仓库')
    await mkdir(path.join(plain, 'src/contents/post'), { recursive: true })
    await writeFile(path.join(plain, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
    const other = createServices(path.join(temporary, 'other', 'settings.json'))
    await other.projects.select(plain)
    await expect(other.content.pullRemote({ projectPath: plain })).rejects.toThrow(/不是 Git 仓库/)

    const detached = path.join(temporary, '没有远程')
    await mkdir(path.join(detached, 'src/contents/post'), { recursive: true })
    await writeFile(path.join(detached, 'package.json'), JSON.stringify({ dependencies: { astro: '^5.3.0' } }))
    await git(detached, 'init', '-b', 'main')
    await git(detached, 'config', 'user.name', 'Test')
    await git(detached, 'config', 'user.email', 'test@example.invalid')
    await git(detached, 'add', '.')
    await git(detached, 'commit', '-m', 'fixture')
    const local = createServices(path.join(temporary, 'local', 'settings.json'))
    await local.projects.select(detached)
    await expect(local.content.pullRemote({ projectPath: detached })).rejects.toThrow(/没有配置 origin/)
  })
})
