// Pure compile pipeline shared by the worker and the tests.
// solc's import callback is synchronous, so imports are pre-walked (async) and passed as sources.
export type Solc = { compile(input: string): string }
export type CompileError = { severity: 'error' | 'warning' | 'info'; message: string; line?: number }
export type CompiledContract = { file: string; name: string; abi: any[]; bytecode: `0x${string}` }
export type CompileResult = { contracts: CompiledContract[]; errors: CompileError[] }

const IMPORT_RE = /\bimport\s+(?:[^"';]*?\bfrom\s+)?["']([^"']+)["']/g
const blank = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, m => m.replace(/[^\n]/g, ' '))
const lineAt = (text: string, offset: number) => text.slice(0, offset).split('\n').length

function resolve(from: string, p: string) {
  if (!p.startsWith('./') && !p.startsWith('../')) return p
  const out = from.split('/').slice(0, -1)
  for (const seg of p.split('/')) {
    if (seg === '..') out.pop()
    else if (seg !== '.') out.push(seg)
  }
  return out.join('/')
}

export async function compile(
  solc: Solc,
  sources: Record<string, string>,
  readImport: (path: string) => Promise<string | null>,
): Promise<CompileResult> {
  if (Object.values(sources).every(s => !s.trim())) {
    return { contracts: [], errors: [{ severity: 'error', message: 'Source is empty: write or pick a contract first.' }] }
  }
  const all = { ...sources }
  const errors: CompileError[] = []
  const seen = new Set(Object.keys(all))
  let wave = Object.keys(all)
  while (wave.length) {
    const next: string[] = []
    await Promise.all(
      wave.map(async file => {
        const text = all[file]!
        for (const m of blank(text).matchAll(IMPORT_RE)) {
          const path = resolve(file, m[1]!)
          if (seen.has(path)) continue
          seen.add(path)
          const body = await readImport(path).catch(() => null)
          if (body === null) {
            errors.push({ severity: 'error', message: `Import not found: ${path} (imported from ${file})`, line: lineAt(text, m.index!) })
          } else {
            all[path] = body
            next.push(path)
          }
        }
      }),
    )
    wave = next
  }
  if (errors.length) return { contracts: [], errors }

  let out: any
  try {
    out = JSON.parse(
      solc.compile(
        JSON.stringify({
          language: 'Solidity',
          sources: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, { content: v }])),
          // must match packages/contracts/build.ts so bytecode is identical
          settings: {
            optimizer: { enabled: true, runs: 200 },
            evmVersion: 'cancun',
            outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
          },
        }),
      ),
    )
  } catch (e) {
    return { contracts: [], errors: [{ severity: 'error', message: `Compiler failed: ${e instanceof Error ? e.message : String(e)}` }] }
  }
  for (const e of out.errors ?? []) {
    const loc = e.sourceLocation
    errors.push({
      severity: e.severity,
      message: e.formattedMessage ? String(e.formattedMessage).split('\n')[0]!.replace(/^\w+(?: \(\d+\))?: /, '') : e.message,
      // only user files have a line the editor can show
      line: loc && loc.file in sources ? lineAt(sources[loc.file]!, loc.start) : undefined,
    })
  }
  const contracts: CompiledContract[] = []
  for (const file of Object.keys(sources)) {
    for (const [name, c] of Object.entries<any>(out.contracts?.[file] ?? {})) {
      const object = c.evm?.bytecode?.object
      if (object) contracts.push({ file, name, abi: c.abi, bytecode: `0x${object}` })
    }
  }
  return { contracts, errors }
}
