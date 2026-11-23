import {expect, test} from 'bun:test'
import {createNode} from 'webevm'
import {createPublicClient, createWalletClient, custom, keccak256, parseEventLogs, toHex, type Address} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {Aliases, ChainAccess} from './index.ts'

const admin = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const joiner = privateKeyToAccount(`0x${'22'.repeat(32)}`)
type Account = typeof admin

async function setup(fn: (c: Awaited<ReturnType<typeof ctx>>) => Promise<void>) {
  const blockEnv = {timestamp: 1_000_000n}
  const node = await createNode({
    chainId: 31337,
    miningConfig: {type: 'auto'},
    blockEnv,
    initialBalances: {[admin.address]: 10n ** 21n, [joiner.address]: 10n ** 21n},
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
  const access = (await pub.waitForTransactionReceipt({
    hash: await wallet(admin).deployContract({abi: ChainAccess.abi, bytecode: ChainAccess.bytecode, chain: null}),
  })).contractAddress!
  const aliases = (await pub.waitForTransactionReceipt({
    hash: await wallet(admin).deployContract({abi: Aliases.abi, bytecode: Aliases.bytecode, args: [access], chain: null}),
  })).contractAddress!
  // fixed gas so a revert is mined (status 'reverted') instead of failing estimation
  const send = async (from: Account, to: Address, abi: any, functionName: string, args: unknown[]) =>
    pub.waitForTransactionReceipt({hash: await wallet(from).writeContract({address: to, abi, functionName, args, chain: null, gas: 500_000n} as any)})
  const acc = (from: Account, fn: string, args: unknown[]) => send(from, access, ChainAccess.abi, fn, args)
  const read = (fn: string, args: unknown[] = []) => pub.readContract({address: access, abi: ChainAccess.abi, functionName: fn, args} as any)
  return {pub, access, aliases, send, acc, read, blockEnv}
}

const code = 'one-two-three-four'
const hash = keccak256(toHex(code))

test('admin is the deployer', () => setup(async ({read}) => {
  expect(await read('admin')).toBe(admin.address)
}), 60_000)

test('a create-chain code: claim succeeds once, adds no role, emits Claimed', () => setup(async ({acc, read}) => {
  expect((await acc(admin, 'invite', [hash, 3600n, 1, 4])).status).toBe('success')
  const r = await acc(joiner, 'claim', [code])
  expect(r.status).toBe('success')
  const [ev] = parseEventLogs({abi: ChainAccess.abi, logs: r.logs, eventName: 'Claimed'}) as any[]
  expect(ev.args).toMatchObject({codeHash: hash, who: joiner.address, usesLeft: 0})
  expect(await read('canWrite', [joiner.address])).toBe(false)
  expect(await read('canRead', [joiner.address])).toBe(false)
  expect(await read('readers')).toEqual([])
  expect((await acc(joiner, 'claim', [code])).status).toBe('reverted')
}), 60_000)

test('a 2-use code refuses the third claim', () => setup(async ({acc}) => {
  await acc(admin, 'invite', [hash, 3600n, 2, 4])
  expect((await acc(joiner, 'claim', [code])).status).toBe('success')
  expect((await acc(admin, 'claim', [code])).status).toBe('success')
  expect((await acc(joiner, 'claim', [code])).status).toBe('reverted')
}), 60_000)

test('an expired code is refused', () => setup(async ({acc, blockEnv}) => {
  await acc(admin, 'invite', [hash, 60n, 1, 4])
  blockEnv.timestamp += 61n
  expect((await acc(joiner, 'claim', [code])).status).toBe('reverted')
}), 60_000)

test('invite with grants 0 or 8 reverts; 7 is fine', () => setup(async ({acc}) => {
  expect((await acc(admin, 'invite', [hash, 60n, 1, 0])).status).toBe('reverted')
  expect((await acc(admin, 'invite', [hash, 60n, 1, 8])).status).toBe('reverted')
  expect((await acc(admin, 'invite', [hash, 60n, 1, 7])).status).toBe('success')
}), 60_000)

test('Aliases: only the ChainAccess admin can register', () => setup(async ({send, aliases, access}) => {
  const args = ['demo', access, 'recipe', '{}', '0x0000000000000000000000000000000000000000']
  expect((await send(joiner, aliases, Aliases.abi, 'register', args)).status).toBe('reverted')
  expect((await send(admin, aliases, Aliases.abi, 'register', args)).status).toBe('success')
}), 60_000)
