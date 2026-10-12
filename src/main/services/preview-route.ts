import { createHash } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import type { ContentKind } from '../../shared/contracts'
import { isMissing, ServiceError } from './errors'
import { readBounded, safePath } from './paths'

export type SlugMode = 'RAW' | 'HASH' | 'PINYIN'

export function collectionId(relativePath: string, kind: ContentKind): string | null {
  if (kind === 'draft') return null
  const prefix = kind === 'post' ? 'src/contents/post/' : 'src/contents/ai-daily/'
  if (!relativePath.startsWith(prefix)) return null
  const rest = relativePath.slice(prefix.length)
  if (!rest || rest.split('/').some(part => !part || part === '.' || part === '..')) return null
  return rest.replace(/\.mdx?$/i, '')
}

export function readSlugMode(source: string): SlugMode | null {
  const matches = [...source.matchAll(/slugMode\s*:\s*['"](RAW|HASH|PINYIN)['"]/g)].map(match => match[1] as SlugMode)
  return matches.length === 1 ? matches[0] : null
}

export function hashSlug(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 8)
}

export function pinyinSlug(text: string, convert: (segment: string) => string[]): string {
  const segments: Array<{ text: string; chinese: boolean }> = []
  for (const char of text) {
    const chinese = /[\u4e00-\u9fff]/.test(char)
    const current = segments.at(-1)
    if (!current || current.chinese !== chinese) segments.push({ text: char, chinese })
    else current.text += char
  }
  return segments.map(segment => {
    if (segment.chinese) return convert(segment.text).join('-')
    return segment.text.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  }).filter(Boolean).join('-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
}

export function postPath(id: string, mode: SlugMode, convert: (segment: string) => string[]): string {
  const slug = mode === 'HASH' ? hashSlug(id) : mode === 'PINYIN' ? pinyinSlug(id, convert) : id
  return `/post/${slug.split('/').map(segment => encodeURIComponent(segment)).join('/')}`
}

export function dailyPath(id: string): string {
  return `/ai-daily#daily-${encodeURIComponent(id.replaceAll('/', '-'))}`
}

export async function readProjectSlugMode(projectPath: string): Promise<SlugMode | 'missing' | 'unreadable'> {
  try {
    const source = (await readBounded(await safePath(projectPath, 'yukina.config.ts'), 128 * 1024)).text
    return readSlugMode(source) ?? 'unreadable'
  } catch (error) {
    if (isMissing(error) || (error instanceof ServiceError && (error.code === 'NOT_A_FILE' || error.code === 'PATH_OUTSIDE_PROJECT'))) return 'missing'
    return 'unreadable'
  }
}

export function spawnPinyin(nodePath: string, projectPath: string, segment: string, env: NodeJS.ProcessEnv): Promise<string[] | null> {
  const script = `import { pinyin } from 'pinyin-pro'\nconst value = pinyin(process.argv[1] ?? '', { toneType: 'none', type: 'array' })\nif (!Array.isArray(value) || value.some(item => typeof item !== 'string')) process.exit(2)\nprocess.stdout.write(JSON.stringify(value))\n`
  return new Promise(resolve => {
    const child: ChildProcess = spawn(nodePath, ['--input-type=module', '-e', script, '--', segment], {
      cwd: projectPath, env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    const timer = setTimeout(() => { child.kill(); resolve(null) }, 8000)
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.on('error', () => { clearTimeout(timer); resolve(null) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) { resolve(null); return }
      try {
        const parsed = JSON.parse(stdout) as unknown
        resolve(Array.isArray(parsed) && parsed.every(item => typeof item === 'string') ? parsed : null)
      } catch { resolve(null) }
    })
  })
}
