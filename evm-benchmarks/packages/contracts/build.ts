import {readFileSync, writeFileSync, mkdirSync} from 'node:fs'
import {dirname, join} from 'node:path'
import solc from 'solc'

const root = import.meta.dir
// Resolve OZ wherever bun hoisted it.
const ozRoot = dirname(dirname(dirname(Bun.resolveSync('@openzeppelin/contracts/package.json', root))))

const names = ['MintableToken', 'AtomicSwap', 'AssetToken', 'Swap', 'OrderBook', 'Settlement', 'Pool', 'HashLock', 'ChainAccess', 'Aliases', 'AllowList', 'Onboarding']
const sources = Object.fromEntries(
  names.map((n) => [`${n}.sol`, {content: readFileSync(join(root, 'src', `${n}.sol`), 'utf8')}]),
)

const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: {enabled: true, runs: 200},
    evmVersion: 'cancun',
    outputSelection: {'*': {'*': ['abi', 'evm.bytecode.object']}},
  },
}

// OZ imports resolve under ozRoot, local ones (e.g. "./IAllows.sol") under src
const findImport = (path: string) => {
  for (const dir of [ozRoot, join(root, 'src')]) {
    try {
      return {contents: readFileSync(join(dir, path), 'utf8')}
    } catch {}
  }
  return {error: `not found: ${path}`}
}

const out = JSON.parse(solc.compile(JSON.stringify(input), {import: findImport}))
const errors = (out.errors ?? []).filter((e: {severity: string}) => e.severity === 'error')
if (errors.length) throw new Error(errors.map((e: {formattedMessage: string}) => e.formattedMessage).join('\n'))

mkdirSync(join(root, 'artifacts'), {recursive: true})
for (const n of names) {
  const c = out.contracts[`${n}.sol`][n]
  writeFileSync(
    join(root, 'artifacts', `${n}.json`),
    JSON.stringify({abi: c.abi, bytecode: `0x${c.evm.bytecode.object}`}, null, 2) + '\n',
  )
}
console.log('built', names.join(', '))
