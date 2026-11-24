import { expect, test } from 'bun:test'
import { getAddress } from 'viem'
import { chainAcl } from '../src/acl'

const a = '0x' + '1'.repeat(40), b = '0x' + 'a'.repeat(40), c = '0x' + '3'.repeat(40)
const fake = (readOpen = false) => async (fn: string, args: unknown[] = []) => {
  const t: Record<string, unknown> = { admin: a, writers: [b, a.toUpperCase().replace('0X', '0x')], readers: [c, b], readOpen,
    canWrite: args[0] === a || args[0] === b, canRead: readOpen || args[0] !== '0xnope' }
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
