import { expect, test } from 'bun:test'
import { getAddress } from 'viem'
import { chainAcl } from '../src/acl'

const a = '0x' + '1'.repeat(40), b = '0x' + 'a'.repeat(40), c = '0x' + '3'.repeat(40)
const fake = (readOpen = false) => async (fn: string, args: unknown[] = []) => {
  const t: Record<string, unknown> = { admin: a, writers: [b, a.toUpperCase().replace('0X', '0x')], readers: [c, b], readOpen,
    canWrite: args[0] === a || args[0] === b, deployers: [c], canDeploy: args[0] === a || args[0] === c, canRead: readOpen || args[0] !== '0xnope' }
  return t[fn]
}

test('chainAcl lists admin and writers in write, plus readers in read', async () => {
  const l = await chainAcl(fake()).list()
  expect(l.write).toEqual([getAddress(a), getAddress(b)])
  expect(l.read).toEqual([getAddress(a), getAddress(b), getAddress(c)])
  expect(await chainAcl(fake()).canWrite(a as never)).toBe(true)
})

test('readOpen reported, read list unchanged', async () => {
  const l = await chainAcl(fake(true)).list()
  expect(l.readOpen).toBe(true)
  expect(l.read).toEqual([getAddress(a), getAddress(b), getAddress(c)])
})

test('deploy list is admin + deployers; canDeploy asks the contract', async () => {
  const acl = chainAcl(fake())
  expect((await acl.list()).deploy).toEqual([getAddress(a), getAddress(c)])
  expect((await acl.list()).deployRole).toBe(true)
  expect(await acl.canDeploy(c as never)).toBe(true)
  expect(await acl.canDeploy(b as never)).toBe(false)
})

test('an old ChainAccess (canDeploy/deployers revert) falls back to write', async () => {
  const old = async (fn: string, args: unknown[] = []) => {
    if (fn === 'canDeploy' || fn === 'deployers') throw new Error('execution reverted')
    return fake()(fn, args)
  }
  const acl = chainAcl(old)
  expect((await acl.list()).deploy).toEqual([getAddress(a), getAddress(b)])
  expect((await acl.list()).deployRole).toBe(false)
  expect(await acl.canDeploy(b as never)).toBe(true)
  expect(await acl.canDeploy(c as never)).toBe(false)
})

test('only an absent function falls back: any other error rejects instead of granting deploy', async () => {
  for (const msg of ['node gone', 'execution reverted: paused', 'timeout']) {
    const broken = async (fn: string, args: unknown[] = []) => { if (fn === 'canDeploy' || fn === 'deployers') throw new Error(msg); return fake()(fn, args) }
    await expect(chainAcl(broken).canDeploy(b as never)).rejects.toThrow(msg)
    await expect(chainAcl(broken).list()).rejects.toThrow(msg)
  }
  const nodata = async (fn: string, args: unknown[] = []) => { if (fn === 'canDeploy') throw new Error('The contract function "canDeploy" returned no data ("0x").'); return fake()(fn, args) }
  expect(await chainAcl(nodata).canDeploy(b as never)).toBe(true)
})
