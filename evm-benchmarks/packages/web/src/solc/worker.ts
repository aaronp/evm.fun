/// <reference lib="webworker" />
// Module worker: loads soljson lazily on the first compile, resolves OpenZeppelin imports over fetch.
import { compileFile, type Solc } from './compile'

let solc: Promise<Solc> | undefined

// Module workers have no importScripts, so evaluate soljson.js at global scope ourselves.
function load(base: string): Promise<Solc> {
  return (solc ??= (async () => {
    const res = await fetch(new URL('solc/soljson.js', base))
    if (!res.ok) throw new Error(`Could not load the Solidity compiler (HTTP ${res.status})`)
    const code = await res.text()
    // soljson is "use strict", so its `var Module` stays local to the eval: export it ourselves.
    // It initialises synchronously (wasm is embedded), like solc-js in node.
    const mod = (0, eval)(`${code}\n;Module`)
    const raw = mod.cwrap('solidity_compile', 'string', ['string', 'number', 'number'])
    return { compile: (input: string) => raw(input, 0, 0) }
  })().catch(e => ((solc = undefined), Promise.reject(e))))
}

async function readImport(base: string, path: string) {
  if (!path.startsWith('@openzeppelin/contracts/')) return null
  const res = await fetch(new URL(`oz/${path}`, base))
  // the dev server answers unknown paths with index.html (200)
  if (!res.ok || res.headers.get('content-type')?.includes('text/html')) return null
  return res.text()
}

self.onmessage = async (e: MessageEvent<{ id: number; base: string; source: string; fileName: string }>) => {
  const { id, base, source, fileName } = e.data
  try {
    const s = await load(base)
    postMessage({ id, result: await compileFile(s, fileName, source, p => readImport(base, p)) })
  } catch (err) {
    postMessage({ id, result: { contracts: [], errors: [{ severity: 'error', message: err instanceof Error ? err.message : String(err) }] } })
  }
}
