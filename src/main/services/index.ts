import path from 'node:path'
import { readdir, realpath, stat } from 'node:fs/promises'
import type { ArticleDocument, ArticleTarget, ContentIndex, OpenExternalEditorResult, ProjectInfo } from '../../shared/contracts'
import { CONTENT_DIRECTORIES, contentKind, inspectProject, parseArticle } from '../adapters/promefire'
import { ServiceError, errorMessage } from './errors'
import { ARTICLE_SIZE_LIMIT, isWithin, normalizedRelative, readBounded, safePath } from './paths'
import { createSettingsService } from './settings'
import { readGit } from './git'
import { createDraft, validateDraftInput } from './drafts'
import { createEditorService } from './editor'
import { inspectExternalEditor, launchExternalEditor } from './external-editor'

export { ServiceError } from './errors'

export function createServices(settingsFilePath: string) {
  const settings = createSettingsService(settingsFilePath)
  const editor = createEditorService(path.join(path.dirname(settingsFilePath), 'editor'))
  let active: ProjectInfo | null = null
  let projectQueue: Promise<unknown> = Promise.resolve()
  function serialProject<T>(operation: () => Promise<T>): Promise<T> {
    const result = projectQueue.then(operation)
    projectQueue = result.catch(() => undefined)
    return result
  }
  function current(): ProjectInfo {
    if (!active) throw new ServiceError('NO_PROJECT', '请先选择本地 Astro 博客目录。')
    return active
  }
  async function activate(directory: string): Promise<ProjectInfo> {
    const project = await inspectProject(directory)
    await settings.rememberProject(project.path, project.name)
    active = project
    return structuredClone(project)
  }
  async function resolve(project: ProjectInfo, relativePath: string): Promise<string> {
    const relative = normalizedRelative(relativePath)
    const kind = contentKind(relative)
    if (!kind) throw new ServiceError('UNSUPPORTED_CONTENT', '只能访问普通文章 .md/.mdx 或 AI 日报 .md。')
    const resolved = await safePath(project.path, relative)
    const collection = await safePath(project.path, CONTENT_DIRECTORIES[kind])
    if (!isWithin(collection, resolved)) throw new ServiceError('PATH_OUTSIDE_COLLECTION', '文章链接指向当前内容目录之外。')
    if (!(await stat(resolved)).isFile()) throw new ServiceError('NOT_A_FILE', '文章路径不是普通文件。')
    return resolved
  }
  async function read(project: ProjectInfo, relativePath: string, gitState: Awaited<ReturnType<typeof readGit>>): Promise<ArticleDocument> {
    const relative = normalizedRelative(relativePath)
    const file = await resolve(project, relative)
    const result = await readBounded(file, ARTICLE_SIZE_LIMIT)
    // Revalidate after I/O to reject a changed symlink target before returning content.
    if (await resolve(project, relative) !== file) throw new ServiceError('FILE_CHANGED', '文章路径在读取时发生变化，请刷新后重试。')
    const isIgnored = [...gitState.statuses].some(([entry, status]) => status === 'ignored' && relative.startsWith(`${entry.replace(/\/$/, '')}/`))
    return parseArticle(result.text, relative, contentKind(relative)!, {
      modifiedAt: result.modifiedAt, size: result.size,
      fileStatus: gitState.statusAvailable ? gitState.statuses.get(relative) ?? (isIgnored ? 'ignored' : 'clean') : 'unknown',
    })
  }
  return {
    settings: { get: settings.get, setTheme: settings.setTheme, forgetProject: settings.forgetProject, setExternalEditor: settings.setExternalEditor, checkExternalEditor: settings.checkExternalEditor },
    projects: {
      select: (directory: string) => serialProject(() => activate(directory)),
      openRecent: (directory: string) => serialProject(async () => {
        if (!(await settings.get()).recentProjects.some((project) => project.path === directory)) throw new ServiceError('PROJECT_NOT_AUTHORIZED', '该目录不在最近项目中，请通过目录选择器打开。')
        // Remembered directories may have become junctions after their original selection.
        if (await realpath(directory) !== directory) throw new ServiceError('PROJECT_PATH_CHANGED', '最近项目路径已指向其他位置，请重新选择目录。')
        return activate(directory)
      }),
      getCurrent: async () => active ? structuredClone(active) : null,
      refresh: () => serialProject(async () => {
        const project = current()
        if (await realpath(project.path) !== project.path) throw new ServiceError('PROJECT_PATH_CHANGED', '项目目录已指向其他位置，请重新选择。')
        active = await inspectProject(project.path)
        return structuredClone(active)
      }),
    },
    content: {
      save: (input: unknown) => serialProject(() => editor.save(current(), input)),
      createDraft: (input: unknown) => serialProject(() => createDraft(current(), validateDraftInput(input))),
      resolveArticlePath: async (relative: string) => resolve(current(), relative),
      read: async (relative: string) => { const project = current(); return read(project, relative, await readGit(project.path)) },
      list: async (): Promise<ContentIndex> => {
        const project = current()
        const gitState = await readGit(project.path)
        const index: ContentIndex = { articles: [], issues: [], scannedAt: new Date().toISOString() }
        const visited = new Set<string>()
        let entriesScanned = 0
        async function scan(directory: string, depth: number): Promise<void> {
          try {
            if (depth > 32) throw new ServiceError('SCAN_LIMIT', '目录层级超过扫描限制。')
            const resolved = await safePath(project.path, directory)
            if (visited.has(resolved)) return
            visited.add(resolved)
            const entries = await readdir(resolved, { withFileTypes: true })
            for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
              if (++entriesScanned > 20000) throw new ServiceError('SCAN_LIMIT', '内容目录超过 20,000 个条目，已停止继续扫描。')
              const relative = `${directory}/${entry.name}`
              try {
                const target = await safePath(project.path, relative)
                const info = await stat(target)
                if (info.isDirectory()) await scan(relative, depth + 1)
                else if (info.isFile() && contentKind(relative)) index.articles.push((await read(project, relative, gitState)).article)
              } catch (error) { index.issues.push({ path: relative, message: errorMessage(error) }) }
            }
          } catch (error) { index.issues.push({ path: directory, message: errorMessage(error) }) }
        }
        for (const directory of Object.values(CONTENT_DIRECTORIES)) await scan(directory, 0)
        index.articles.sort((a, b) => (b.published ?? '').localeCompare(a.published ?? '') || a.relativePath.localeCompare(b.relativePath))
        return index
      },
    },
    externalEditor: {
      open: (value: unknown): Promise<OpenExternalEditorResult> => serialProject(async () => {
        const project = current()
        if (!value || typeof value !== 'object') throw new ServiceError('INVALID_EDITOR_INPUT', '文章参数无效。')
        const input = value as Partial<ArticleTarget>
        if (input.projectPath !== project.path) throw new ServiceError('PROJECT_CHANGED', '当前项目已切换，请重新打开目标文章。')
        const relativePath = normalizedRelative(input.relativePath ?? '')
        const status = await inspectExternalEditor((await settings.get()).externalEditorPath)
        if (status.state === 'unconfigured') throw new ServiceError('EDITOR_NOT_CONFIGURED', status.message)
        if (status.state === 'missing') throw new ServiceError('EDITOR_NOT_FOUND', status.message)
        if (status.state !== 'ready' || !status.path) throw new ServiceError('EDITOR_INVALID', status.message)
        const articlePath = await resolve(project, relativePath)
        await launchExternalEditor(status.path, articlePath)
        return { editorPath: status.path, articlePath }
      }),
    },
    editor: {
      checkpoint: (input: unknown) => serialProject(() => editor.checkpoint(current(), input)),
      getRecovery: (input: unknown) => serialProject(() => editor.get(current(), input)),
      clearRecovery: (input: unknown) => serialProject(() => editor.clear(current(), input)),
      listRecoveries: () => serialProject(() => editor.list(current())),
    },
  }
}
