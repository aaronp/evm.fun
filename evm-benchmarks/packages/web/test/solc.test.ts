import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import solc from 'solc'
import { MintableToken } from '@evmb/contracts'
import { compile } from '../src/solc/compile'

const oz = dirname(dirname(dirname(Bun.resolveSync('@openzeppelin/contracts/package.json', import.meta.dir))))
const readImport = async (p: string) => {
  try { return readFileSync(join(oz, p), 'utf8') } catch { return null }
}
const run = (src: string, name = 'Main.sol') => compile(solc, { [name]: src }, readImport)
const mintable = readFileSync(join(import.meta.dir, '../../contracts/src/MintableToken.sol'), 'utf8')

describe('compile', () => {
  test('same bytecode as @evmb/contracts', async () => {
    const r = await run(mintable, 'MintableToken.sol')
    expect(r.errors.filter(e => e.severity === 'error')).toEqual([])
    expect(r.contracts.find(c => c.name === 'MintableToken')!.bytecode).toBe(MintableToken.bytecode)
  }, 60_000)

  test('syntax error has line', async () => {
    const r = await run('contract A {\n  uint x\n}\n')
    const e = r.errors.find(e => e.severity === 'error')!
    expect(e.line).toBeGreaterThan(0)
    expect(r.contracts).toEqual([])
  })

  test('missing import names the path', async () => {
    const r = await run('import "@openzeppelin/contracts/Nope.sol";\ncontract A {}')
    expect(r.errors.some(e => e.severity === 'error' && e.message.includes('Nope.sol'))).toBe(true)
  })

  test('relative and star import forms resolve', async () => {
    const r = await compile(
      solc,
      { 'a/Main.sol': 'import * as L from "../lib/L.sol";\nimport {Q} from "./Q.sol";\ncontract M is Q { function f() external pure returns (uint) { return L.g(); } }' },
      async p => ({
        'lib/L.sol': 'function g() pure returns (uint) { return 1; }',
        'a/Q.sol': 'contract Q {}',
      })[p] ?? null,
    )
    expect(r.errors.filter(e => e.severity === 'error')).toEqual([])
    expect(r.contracts.map(c => c.name)).toContain('M')
  })

  test('empty source gives a clear error', async () => {
    const r = await run('   ')
    expect(r.contracts).toEqual([])
    expect(r.errors[0]!.severity).toBe('error')
    expect(r.errors[0]!.message).toMatch(/empty/i)
  })

  test('multi-contract', async () => {
    const r = await run('contract A {}\ncontract B {}')
    expect(r.contracts.map(c => c.name).sort()).toEqual(['A', 'B'])
  })
})
