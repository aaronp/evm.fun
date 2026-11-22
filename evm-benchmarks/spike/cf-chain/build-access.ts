// Compiles contracts/ChainAccess.sol with the repo's solc (packages/contracts) -> src/ChainAccess.json
//   bun spike/cf-chain/build-access.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const solc = (await import(Bun.resolveSync('solc', join(import.meta.dir, '../../packages/contracts')))).default

const input = {
  language: 'Solidity',
  sources: { 'ChainAccess.sol': { content: readFileSync(join(import.meta.dir, 'contracts/ChainAccess.sol'), 'utf8') } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.deployedBytecode.object', 'storageLayout'] } } },
}
const out = JSON.parse(solc.compile(JSON.stringify(input)))
const errs = (out.errors ?? []).filter((e: any) => e.severity === 'error')
if (errs.length) throw new Error(errs.map((e: any) => e.formattedMessage).join('\n'))
const c = out.contracts['ChainAccess.sol'].ChainAccess
// src/chain.ts hardcodes this layout when it writes genesis storage; fail loudly if it moves
const layout = c.storageLayout.storage.map((s: any) => `${s.label}@${s.slot}+${s.offset}`).join(' ')
if (layout !== 'admin@0+0 readOpen@0+20 isReader@1+0 isWriter@2+0 inviteExpiry@3+0') throw new Error(`layout changed: ${layout}`)
writeFileSync(join(import.meta.dir, 'src/ChainAccess.json'), JSON.stringify({ abi: c.abi, runtime: `0x${c.evm.deployedBytecode.object}` }) + '\n')
console.log(`built ChainAccess: runtime ${c.evm.deployedBytecode.object.length / 2} bytes, layout ${layout}`)
