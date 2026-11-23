// Compiles contracts/*.sol with the repo's solc (packages/contracts) -> src/<Name>.json {abi, runtime, bytecode}
//   bun spike/cf-chain/build-access.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const solc = (await import(Bun.resolveSync('solc', join(import.meta.dir, '../../packages/contracts')))).default

const names = ['ChainAccess', 'Aliases', 'Notice']
const input = {
  language: 'Solidity',
  sources: Object.fromEntries(names.map((n) => [`${n}.sol`, { content: readFileSync(join(import.meta.dir, `contracts/${n}.sol`), 'utf8') }])),
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'storageLayout'] } } },
}
const out = JSON.parse(solc.compile(JSON.stringify(input)))
const errs = (out.errors ?? []).filter((e: any) => e.severity === 'error')
if (errs.length) throw new Error(errs.map((e: any) => e.formattedMessage).join('\n'))
// src/chain.ts hardcodes these layouts when it writes genesis storage; fail loudly if they move
const LAYOUT: Record<string, string> = {
  ChainAccess: 'admin@0+0 readOpen@0+20 _readers@1+0 _writers@2+0 readerIdx@3+0 writerIdx@4+0 invites@5+0',
  Aliases: '_all@0+0 _idx@1+0',
}
for (const n of names) {
  const c = out.contracts[`${n}.sol`][n]
  const layout = c.storageLayout.storage.map((s: any) => `${s.label}@${s.slot}+${s.offset}`).join(' ')
  if (LAYOUT[n] && layout !== LAYOUT[n]) throw new Error(`${n} layout changed: ${layout}`)
  writeFileSync(join(import.meta.dir, `src/${n}.json`), JSON.stringify({ abi: c.abi, runtime: `0x${c.evm.deployedBytecode.object}`, bytecode: `0x${c.evm.bytecode.object}` }) + '\n')
  console.log(`built ${n}: runtime ${c.evm.deployedBytecode.object.length / 2} bytes, layout ${layout}`)
}
