import { spawn } from 'node:child_process'
import path from 'node:path'
import type { PreviewArticleResult, PreviewRuntimeSetting, PreviewState } from '../../shared/contracts'
import { contentKind } from '../adapters/promefire'
import { ServiceError } from './errors'
import { inspectPreviewEnvironment, previewChildEnv, spawnDevProcess, type ResolvedRuntime } from './preview-env'
import { createLogBuffer } from './preview-log'
import { collectionId, dailyPath, postPath, readProjectSlugMode, spawnPinyin } from './preview-route'
import { joinLocalUrl, latestLocalUrl, localOrigin } from './preview-url'
import { normalizedRelative } from './paths'

type ProjectSource = () => { path: string } | null
const EMPTY_RUNTIME: PreviewRuntimeSetting = { nodePath: null, npmPath: null }

function idleState(projectPath: string | null): PreviewState {
  return { projectPath, phase: 'idle', url: null, message: '尚未启动本地预览。', log: '', exitCode: null, checks: [], runtime: null }
}

export function createPreviewService(options: {
  project: ProjectSource
  runtimeSetting(): Promise<PreviewRuntimeSetting>
  saveRuntime(setting: PreviewRuntimeSetting): Promise<unknown>
  timeoutMs?: number
}) {
  let state = idleState(null)
  let token = 0
  let owned: { pid: number; generation: number; projectPath: string } | null = null
  let hint = ''
  let readyTimer: ReturnType<typeof setTimeout> | null = null
  let chain: Promise<unknown> = Promise.resolve()
  const clearReadyTimer = () => { if (readyTimer) clearTimeout(readyTimer); readyTimer = null }
  const log = createLogBuffer()
  const listeners = new Set<(snapshot: PreviewState) => void>()
  const pinyinCache = new Map<string, string[]>()
  const lock = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = chain.then(operation, operation)
    chain = result.then(() => undefined, () => undefined)
    return result
  }
  const publish = () => { const snapshot = structuredClone(state); for (const listener of listeners) listener(snapshot) }
  const projectPath = () => {
    const project = options.project()
    if (!project) throw new ServiceError('NO_PROJECT', '请先选择本地 Astro 博客目录。')
    return project.path
  }
  const fail = (generation: number, message: string, exitCode: number | null = null) => {
    if (generation !== token) return
    clearReadyTimer()
    state = { ...state, phase: 'failed', message, exitCode, log: log.text() }
    owned = null
    publish()
  }
  const killOwned = async (pid: number) => {
    const root = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows'
    await new Promise<void>(resolve => {
      const killer = spawn(path.win32.join(root, 'System32', 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { windowsHide: true, shell: false })
      killer.on('exit', () => resolve())
      killer.on('error', () => resolve())
    })
  }
  const probe = async (url: string) => {
    const http = await import('node:http')
    return new Promise<number | null>(resolve => {
      const request = http.get(url, { timeout: 2500 }, response => { response.resume(); resolve(response.statusCode ?? null) })
      request.on('error', () => resolve(null))
      request.on('timeout', () => { request.destroy(); resolve(null) })
    })
  }
  const consider = async (generation: number, project: string, url: string) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (generation !== token || state.phase !== 'starting' || state.projectPath !== project) return
      const status = await probe(url)
      if (generation !== token || state.phase !== 'starting') return
      if (status !== null && status >= 200 && status < 400 && localOrigin(url)) {
        clearReadyTimer()
        state = { ...state, phase: 'running', url, message: '本地预览已可访问。页面来自当前博客的开发服务器。', log: log.text(), exitCode: null }
        publish()
        return
      }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
  const accept = (generation: number, project: string, chunk: Buffer) => {
    if (generation !== token || state.projectPath !== project) return
    if (state.phase !== 'starting' && state.phase !== 'running' && state.phase !== 'stopping') return
    log.push(chunk.toString('utf8'))
    state = { ...state, log: log.text() }
    const found = latestLocalUrl(state.log)
    publish()
    if (found && found !== state.url && state.phase === 'starting') void consider(generation, project, found)
  }
  const exited = (generation: number, code: number | null) => {
    if (generation !== token) return
    log.flush()
    if (state.phase === 'stopping') {
      owned = null
      state = { ...state, phase: 'idle', url: null, exitCode: code, message: '本地预览已停止。', log: log.text() }
      publish()
      return
    }
    const message = hint || (state.phase === 'running' ? `预览进程已退出（${code ?? '未知'}）。` : code === 0 ? '进程已退出，但预览地址尚未可访问。' : `npm run dev 失败，退出码 ${code ?? '未知'}。`)
    fail(generation, message, code)
  }
  const stopOwned = async () => {
    if (!owned) {
      if (state.phase === 'checking' || state.phase === 'starting') state = { ...state, phase: 'idle', message: '尚未启动本地预览。' }
      return
    }
    const current = owned
    hint = ''
    clearReadyTimer()
    state = { ...state, phase: 'stopping', message: '正在停止本次启动的预览进程。' }
    publish()
    await killOwned(current.pid)
    const started = Date.now()
    while (owned?.generation === current.generation && Date.now() - started < 8000) await new Promise(resolve => setTimeout(resolve, 50))
    if (owned?.generation === current.generation) {
      owned = null
      token += 1
      state = { ...state, phase: 'failed', url: null, message: '停止预览超时。客户端没有按进程名结束其他 Node。', log: log.text() }
      publish()
    }
  }
  return {
    status: () => structuredClone(state),
    hasOwnedProcess: () => owned !== null,
    subscribe(listener: (snapshot: PreviewState) => void) { listeners.add(listener); return () => listeners.delete(listener) },
    check: () => lock(async () => {
      const current = projectPath()
      if (state.phase === 'starting' || state.phase === 'running' || state.phase === 'stopping') return structuredClone(state)
      state = { ...state, projectPath: current, phase: 'checking', message: '正在检查 Node.js、npm、dev 脚本和 Astro 依赖。' }
      publish()
      const report = await inspectPreviewEnvironment({ projectPath: current, configured: await options.runtimeSetting() })
      state = { ...state, phase: report.ok ? 'idle' : 'failed', checks: report.checks, runtime: report.runtime, message: report.ok ? '环境检查通过，可以启动本地预览。' : '环境检查未通过。修正后可以重试，客户端不会自动安装依赖或修改脚本。', log: log.text() }
      publish()
      return structuredClone(state)
    }),
    configure: (nodePath: string, npmPath: string) => lock(async () => {
      const current = projectPath()
      const report = await inspectPreviewEnvironment({ projectPath: current, configured: { nodePath, npmPath } })
      if (!report.ok || !report.runtime || report.runtime.source !== 'configured') {
        throw new ServiceError('INVALID_RUNTIME', report.checks.find(item => item.status === 'missing')?.detail ?? '无法验证所选的 Node 和 npm。')
      }
      await options.saveRuntime({ nodePath: report.runtime.nodePath, npmPath: report.runtime.npmPath })
      state = { ...state, projectPath: current, checks: report.checks, runtime: report.runtime, message: '已保存并验证 Node 与 npm。' }
      publish()
      return structuredClone(state)
    }),
    clearRuntime: () => lock(async () => {
      await options.saveRuntime(EMPTY_RUNTIME)
      state = { ...state, runtime: null, message: '已恢复为自动检测 Node 与 npm。' }
      publish()
      return structuredClone(state)
    }),
    start: async (timeoutMs = options.timeoutMs ?? 90_000) => {
      const launched = await lock(async () => {
        const current = projectPath()
        if (state.phase === 'checking' || state.phase === 'starting' || state.phase === 'running' || state.phase === 'stopping') {
          throw new ServiceError('PREVIEW_BUSY', '本地预览正在检查、启动、运行或停止，不能重复启动。')
        }
        const generation = ++token
        hint = ''
        log.clear()
        pinyinCache.clear()
        state = { ...idleState(current), phase: 'checking', message: '正在检查 Node.js、npm、dev 脚本和 Astro 依赖。' }
        publish()
        const report = await inspectPreviewEnvironment({ projectPath: current, configured: await options.runtimeSetting() })
        if (generation !== token) return 0
        state = { ...state, checks: report.checks, runtime: report.runtime }
        if (!report.ok || !report.runtime) { fail(generation, '环境检查未通过，没有启动预览。'); return 0 }
        const runtime: ResolvedRuntime = report.runtime
        state = { ...state, phase: 'starting', message: '正在执行 npm run dev。创建进程还不代表预览已就绪。' }
        publish()
        let child
        try { child = spawnDevProcess(runtime.npmPath, current, previewChildEnv(process.env, path.win32.dirname(runtime.nodePath))) }
        catch (error) { fail(generation, error instanceof Error ? error.message : '无法启动 npm run dev。'); return 0 }
        if (!child.pid) { fail(generation, '没有获得预览进程编号，已停止继续。'); return 0 }
        owned = { pid: child.pid, generation, projectPath: current }
        child.stdout?.on('data', (chunk: Buffer) => accept(generation, current, chunk))
        child.stderr?.on('data', (chunk: Buffer) => accept(generation, current, chunk))
        child.on('error', (error) => { hint = `启动 npm 失败：${error.message}`; exited(generation, null) })
        child.on('exit', (code) => exited(generation, code))
        clearReadyTimer()
        readyTimer = setTimeout(() => {
          if (generation === token && state.phase === 'starting') { hint = '启动超时：开发服务器在时限内没有变得可访问。'; void killOwned(child.pid!) }
        }, timeoutMs)
        return generation
      })
      if (!launched) return structuredClone(state)
      const started = Date.now()
      while (launched === token && state.phase === 'starting' && Date.now() - started < timeoutMs + 10_000) await new Promise(resolve => setTimeout(resolve, 100))
      return structuredClone(state)
    },
    stop: () => lock(async () => { await stopOwned(); return structuredClone(state) }),
    release: (previousPath: string) => lock(async () => {
      if (owned?.projectPath === previousPath) await stopOwned()
      clearReadyTimer()
      token += 1
      log.clear()
      hint = ''
      owned = null
      state = idleState(options.project()?.path ?? null)
      publish()
    }),
    shutdown: () => lock(async () => { await stopOwned(); token += 1; owned = null }),
    async openHome(open: (url: string) => Promise<void>) {
      const origin = state.phase === 'running' ? localOrigin(state.url ?? '') : null
      if (!origin || state.projectPath !== projectPath()) throw new ServiceError('PREVIEW_NOT_RUNNING', '本地预览尚未就绪，不能打开浏览器。')
      const target = `${origin}/`
      await open(target)
      return { url: target }
    },
    async openArticle(relativePath: string, open: (url: string) => Promise<void>): Promise<PreviewArticleResult> {
      const current = projectPath()
      const origin = state.phase === 'running' && state.projectPath === current ? localOrigin(state.url ?? '') : null
      const homepage = origin ? `${origin}/` : null
      if (!origin || !homepage) throw new ServiceError('PREVIEW_NOT_RUNNING', '本地预览尚未就绪。请先启动并等待状态变为运行中。')
      const relative = normalizedRelative(relativePath)
      const kind = contentKind(relative)
      const id = kind ? collectionId(relative, kind) : null
      if (kind === 'draft') return { kind: 'unresolved', url: null, homepage, message: '这篇草稿在 src/contents/drafts。当前博客的 Astro 集合和文章页只读取 src/contents/post，没有草稿路由。不会编造地址。可以打开站点首页。' }
      if (!kind || !id) return { kind: 'unresolved', url: null, homepage, message: '当前文件不在正文或 AI 日报目录中，不能可靠生成站点地址。' }
      let pathname: string | null = null
      if (kind === 'ai-daily') pathname = dailyPath(id)
      else {
        const mode = await readProjectSlugMode(current)
        if (mode === 'missing') return { kind: 'unresolved', url: null, homepage, message: '项目里没有 yukina.config.ts，不能确定普通文章的 slug 规则。可以打开站点首页。' }
        if (mode === 'unreadable') return { kind: 'unresolved', url: null, homepage, message: '无法唯一识别 slugMode，不会猜测文章地址。可以打开站点首页。' }
        if (mode === 'PINYIN') {
          const runtime = state.runtime
          if (!runtime) return { kind: 'unresolved', url: null, homepage, message: '没有已验证的 Node，不能计算拼音地址。可以打开站点首页。' }
          const segments = new Set<string>()
          postPath(id, 'PINYIN', (segment) => { segments.add(segment); return ['x'] })
          const env = previewChildEnv(process.env, path.win32.dirname(runtime.nodePath))
          for (const segment of segments) {
            if (pinyinCache.has(segment)) continue
            const converted = await spawnPinyin(runtime.nodePath, current, segment, env)
            if (!converted) return { kind: 'unresolved', url: null, homepage, message: '项目依赖里的 pinyin-pro 不能完成拼音转换，不会编造文章地址。可以打开站点首页。' }
            pinyinCache.set(segment, converted)
          }
          pathname = postPath(id, 'PINYIN', (segment) => pinyinCache.get(segment) ?? [])
        } else pathname = postPath(id, mode, () => [])
      }
      const target = pathname ? joinLocalUrl(homepage, pathname) : null
      if (!target) return { kind: 'unresolved', url: null, homepage, message: '不能把文章地址限定在已验证的本地预览来源内。可以打开站点首页。' }
      const status = await probe(target)
      if (status === null || status < 200 || status >= 400) {
        return { kind: 'unresolved', url: null, homepage, message: '按博客路由算出的地址没有返回可访问页面，因此没有打开浏览器。可以打开站点首页。' }
      }
      await open(target)
      return { kind: 'opened', url: target, homepage, message: '已在系统浏览器打开站点中的这篇文章。打开的是磁盘上的内容。' }
    },
  }
}
