import type { CompileResult } from './compile'

let worker: Worker | undefined
let nextId = 0
const pending = new Map<number, (r: CompileResult) => void>()

function start() {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = e => {
    pending.get(e.data.id)?.(e.data.result)
    pending.delete(e.data.id)
  }
  w.onerror = ev => {
    const message = `Compiler worker crashed: ${ev.message || 'unknown error'}`
    pending.forEach(r => r({ contracts: [], errors: [{ severity: 'error', message }] }))
    pending.clear()
    w.terminate()
    worker = undefined // next compile starts a fresh worker
  }
  return w
}

export function compileInWorker(source: string): Promise<CompileResult> {
  const w = (worker ??= start())
  return new Promise(res => {
    const id = nextId++
    pending.set(id, res)
    w.postMessage({ id, source, base: document.baseURI })
  })
}
