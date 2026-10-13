import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import type { ProjectInfo } from '../../shared/contracts'

export function createContentWatch(onChange: () => void) {
  let watchers: FSWatcher[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let paused = 0
  const stop = () => {
    if (timer) clearTimeout(timer)
    timer = null
    for (const item of watchers) item.close()
    watchers = []
  }
  return {
    pause() { paused += 1; if (timer) clearTimeout(timer); timer = null },
    resume() { paused = Math.max(0, paused - 1) },
    follow(project: ProjectInfo | null) {
      stop()
      if (!project) return
      const schedule = () => {
        if (paused) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => { timer = null; if (!paused) onChange() }, 400)
      }
      const contents = path.join(project.path, 'src', 'contents')
      try {
        const item = watch(contents, { recursive: true }, schedule)
        item.on('error', () => undefined)
        watchers.push(item)
      } catch { /* The index reports a missing content directory. */ }
    },
    stop,
  }
}
