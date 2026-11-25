import {expect, test} from 'bun:test'
import {createNode} from 'webevm'
import {createPublicClient, createWalletClient, custom, getAddress, keccak256, pad, toHex, type Address} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {AllowList, Onboarding} from './index.ts'

const admin = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const joiner = privateKeyToAccount(`0x${'22'.repeat(32)}`)
const outsider = privateKeyToAccount(`0x${'33'.repeat(32)}`)
type Account = typeof admin
const key = (a: Address) => ({kind: 1, value: pad(a.toLowerCase() as Address)})

async function setup(fn: (c: Awaited<ReturnType<typeof ctx>>) => Promise<void>) {
  const blockEnv = {timestamp: 1_000_000n}
  const node = await createNode({
    chainId: 31337,
    miningConfig: {type: 'auto'},
    blockEnv,
    initialBalances: Object.fromEntries([admin, joiner, outsider].map((a) => [a.address, 10n ** 21n])),
  })
  try {
    await fn(await ctx(node, blockEnv))
  } finally {
    await node.dispose()
  }
}

async function ctx(node: Awaited<ReturnType<typeof createNode>>, blockEnv: {timestamp: bigint}) {
  const transport = custom({request: ({method, params}: any) => node.request({method, params}) as any})
  const pub = createPublicClient({transport})
  const wallet = (a: Account) => createWalletClient({account: a, transport})
  const deploy = async (c: typeof AllowList, args: unknown[]) => (await pub.waitForTransactionReceipt({
    hash: await wallet(admin).deployContract({abi: c.abi, bytecode: c.bytecode, args, chain: null} as any),
  })).contractAddress!
  const list = await deploy(AllowList, [[key(admin.address)]])
  const onb = await deploy(Onboarding, [list])
  // fixed gas so a revert is mined (status 'reverted') instead of failing estimation
  const send = async (from: Account, to: Address, abi: any, functionName: string, args: unknown[]) =>
    pub.waitForTransactionReceipt({hash: await wallet(from).writeContract({address: to, abi, functionName, args, chain: null, gas: 1_000_000n} as any)})
  /** the revert reason string of a simulated call */
  const reasonOf = async (from: Account, to: Address, abi: any, functionName: string, args: unknown[]) => {
    try {
      await pub.simulateContract({account: from, address: to, abi, functionName, args} as any)
    } catch (e: any) {
      const r = e.walk?.((x: any) => typeof x?.reason === 'string')
      if (r) return r.reason as string
      throw e
    }
    throw new Error('did not revert')
  }
  const al = (from: Account, fn: string, args: unknown[]) => send(from, list, AllowList.abi, fn, args)
  const ob = (from: Account, fn: string, args: unknown[]) => send(from, onb, Onboarding.abi, fn, args)
  const alWhy = (from: Account, fn: string, args: unknown[]) => reasonOf(from, list, AllowList.abi, fn, args)
  const obWhy = (from: Account, fn: string, args: unknown[]) => reasonOf(from, onb, Onboarding.abi, fn, args)
  const alRead = (fn: string, args: unknown[] = []) => pub.readContract({address: list, abi: AllowList.abi, functionName: fn, args} as any) as Promise<any>
  const obRead = (fn: string, args: unknown[] = []) => pub.readContract({address: onb, abi: Onboarding.abi, functionName: fn, args} as any) as Promise<any>
  const now = () => blockEnv.timestamp
  // move time; calls see the latest block, so mine one (a self-transfer) at the new timestamp
  const advance = async (s: bigint) => {
    blockEnv.timestamp += s
    await pub.waitForTransactionReceipt({hash: await wallet(admin).sendTransaction({to: admin.address, chain: null} as any)})
  }
  return {list, onb, al, ob, alWhy, obWhy, alRead, obRead, blockEnv, now, advance}
}

const code = 'LETSUEIN'
const hash = keccak256(toHex(code))
const chainA = '0a1b2c3d-0000-4000-8000-00000000000a'
const chainB = '0a1b2c3d-0000-4000-8000-00000000000b'

test('allowlist: member adds and removes a key', () => setup(async ({al, alRead}) => {
  expect(await alRead('allows', [joiner.address, '0x' + '00'.repeat(16), admin.address])).toBe(false)
  expect((await al(admin, 'add', [key(joiner.address)])).status).toBe('success')
  expect(await alRead('allows', [joiner.address, '0x' + '00'.repeat(16), '0x' + '00'.repeat(20)])).toBe(true)
  expect(await alRead('entities')).toEqual([key(admin.address), key(joiner.address)])
  // the new member governs too: removes the deployer
  expect((await al(joiner, 'remove', [key(admin.address)])).status).toBe('success')
  expect(await alRead('allows', [admin.address, '0x' + '00'.repeat(16), '0x' + '00'.repeat(20)])).toBe(false)
  expect(await alRead('entities')).toEqual([key(joiner.address)])
}), 60_000)

test('allowlist: non-member add reverts "not a member"', () => setup(async ({al, alWhy}) => {
  expect(await alWhy(outsider, 'add', [key(outsider.address)])).toBe('not a member')
  expect(await alWhy(outsider, 'remove', [key(admin.address)])).toBe('not a member')
  expect((await al(outsider, 'add', [key(outsider.address)])).status).toBe('reverted')
  expect(await alWhy(admin, 'add', [key(admin.address)])).toBe('already present')
}), 60_000)

test('allowlist: removing the last entity reverts "last entity"', () => setup(async ({al, alWhy, alRead}) => {
  expect(await alWhy(admin, 'remove', [key(admin.address)])).toBe('last entity')
  expect((await al(admin, 'remove', [key(admin.address)])).status).toBe('reverted')
  expect(await alRead('entities')).toEqual([key(admin.address)])
}), 60_000)

test('allowlist: unknown kind reverts', () => setup(async ({alWhy}) => {
  expect(await alWhy(admin, 'add', [{kind: 2, value: pad(joiner.address.toLowerCase() as Address)}])).toBe('unknown kind')
}), 60_000)

test('issue by issuer; by outsider reverts "issuers only"', () => setup(async ({ob, obWhy, obRead, now, list}) => {
  expect(await obRead('issuers')).toBe(getAddress(list))
  expect(await obWhy(outsider, 'issue', [hash, 'sue', now() + 3600n, 1])).toBe('issuers only')
  expect((await ob(admin, 'issue', [hash, 'sue', now() + 3600n, 1])).status).toBe('success')
  expect(await obWhy(outsider, 'revoke', [hash])).toBe('issuers only')
}), 60_000)

test('issue: uses 0 and 1001 revert "bad uses"; reused hash reverts "code exists"', () => setup(async ({ob, obWhy, now}) => {
  expect(await obWhy(admin, 'issue', [hash, 'x', now() + 3600n, 0])).toBe('bad uses')
  expect(await obWhy(admin, 'issue', [hash, 'x', now() + 3600n, 1001])).toBe('bad uses')
  expect(await obWhy(admin, 'issue', [hash, 'x', now(), 1])).toBe('bad expiry')
  expect((await ob(admin, 'issue', [hash, 'x', now() + 3600n, 1000])).status).toBe('success')
  expect(await obWhy(admin, 'issue', [hash, 'x', now() + 3600n, 1])).toBe('code exists')
  await ob(admin, 'revoke', [hash])
  expect(await obWhy(admin, 'issue', [hash, 'x', now() + 3600n, 1])).toBe('code exists')
}), 60_000)

test('redeem records grant; isDeployAllowed true for redeemer only', () => setup(async ({ob, obRead, now, advance}) => {
  await ob(admin, 'issue', [hash, 'sue', now() + 3600n, 1])
  await advance(3600n) // still live at exactly expiresAt
  expect(await obRead('whyNot', [code, chainA])).toBe('')
  expect((await ob(joiner, 'redeem', [code, chainA])).status).toBe('success')
  expect(await obRead('isDeployAllowed', [joiner.address, chainA])).toBe(true)
  expect(await obRead('isDeployAllowed', [outsider.address, chainA])).toBe(false)
  expect(await obRead('isDeployAllowed', [joiner.address, chainB])).toBe(false)
  expect(await obRead('grants', [hash])).toEqual([{by: joiner.address, chainId: chainA, codeHash: hash, at: now()}])
}), 60_000)

// [reason, prepare(ctx), code, chainId]
type Ctx = Parameters<Parameters<typeof setup>[0]>[0]
const refusals: [string, (c: Ctx) => Promise<unknown>, string, string][] = [
  ['bad code', async () => {}, 'ab', chainA],
  ['bad code', async () => {}, 'A'.repeat(17), chainA],
  ['bad code', async () => {}, 'letsuein', chainA],
  ['bad chain id', async () => {}, code, chainA.toUpperCase()],
  ['bad chain id', async () => {}, code, chainA.replaceAll('-', '_')],
  ['bad chain id', async () => {}, code, chainA + '0'],
  ['no such code', async () => {}, 'ZZZZ', chainA],
  ['code revoked', (c) => c.ob(admin, 'revoke', [hash]), code, chainA],
  ['code expired', (c) => c.advance(3601n), code, chainA],
  ['code used up', (c) => c.ob(joiner, 'redeem', [code, chainB]), code, chainA],
  ['chain id taken', async (c) => {
    await c.ob(admin, 'issue', [keccak256(toHex('OTHER1')), 'o', c.now() + 3600n, 1])
    await c.ob(joiner, 'redeem', ['OTHER1', chainA])
  }, code, chainA],
]
test('redeem: each refusal reason', async () => {
  for (const [reason, prepare, c, id] of refusals) {
    await setup(async (x) => {
      await x.ob(admin, 'issue', [hash, 'sue', x.now() + 3600n, 1])
      await prepare(x)
      expect([reason, await x.obRead('whyNot', [c, id])]).toEqual([reason, reason])
      expect([reason, await x.obWhy(outsider, 'redeem', [c, id])]).toEqual([reason, reason])
    })
  }
}, 120_000)

test('revoke stops redeems; an earlier grant stays allowed', () => setup(async ({ob, obWhy, obRead, now}) => {
  await ob(admin, 'issue', [hash, 'sue', now() + 3600n, 5])
  await ob(joiner, 'redeem', [code, chainA])
  expect((await ob(admin, 'revoke', [hash])).status).toBe('success')
  expect(await obWhy(joiner, 'redeem', [code, chainB])).toBe('code revoked')
  expect(await obRead('isDeployAllowed', [joiner.address, chainA])).toBe(true)
}), 60_000)

test('uses 2: two chains then "code used up"', () => setup(async ({ob, obWhy, now}) => {
  await ob(admin, 'issue', [hash, 'sue', now() + 3600n, 2])
  expect((await ob(joiner, 'redeem', [code, chainA])).status).toBe('success')
  expect((await ob(outsider, 'redeem', [code, chainB])).status).toBe('success')
  expect(await obWhy(joiner, 'redeem', [code, '0a1b2c3d-0000-4000-8000-00000000000c'])).toBe('code used up')
}), 60_000)

test('codes() and grants() list status (usesLeft, revoked, grant chainIds)', () => setup(async ({ob, obRead, now, blockEnv}) => {
  const issuedAt = now()
  const h2 = keccak256(toHex('205117'))
  await ob(admin, 'issue', [hash, 'sue', issuedAt + 3600n, 3])
  await ob(admin, 'issue', [h2, 'vouch', issuedAt + 600n, 1])
  blockEnv.timestamp += 10n
  await ob(joiner, 'redeem', [code, chainA])
  await ob(outsider, 'redeem', [code, chainB])
  await ob(admin, 'revoke', [h2])
  expect(await obRead('codes')).toEqual([
    {hash, label: 'sue', issuer: admin.address, issuedAt, expiresAt: issuedAt + 3600n, uses: 3, usesLeft: 1, revoked: false},
    {hash: h2, label: 'vouch', issuer: admin.address, issuedAt, expiresAt: issuedAt + 600n, uses: 1, usesLeft: 1, revoked: true},
  ])
  expect((await obRead('grants', [hash])).map((g: any) => [g.by, g.chainId, g.at])).toEqual([
    [joiner.address, chainA, issuedAt + 10n],
    [outsider.address, chainB, issuedAt + 10n],
  ])
  expect(await obRead('grants', [h2])).toEqual([])
}), 60_000)
