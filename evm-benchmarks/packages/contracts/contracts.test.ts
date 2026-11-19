import {expect, test} from 'bun:test'
import {createNode} from 'webevm'
import {createPublicClient, createWalletClient, custom, type Address} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {AssetToken, AtomicSwap, MintableToken} from './index.ts'

const fnNames = (abi: readonly {type: string; name?: string}[]) =>
  abi.filter((x) => x.type === 'function').map((x) => x.name)

test('MintableToken abi has mint, transfer, approve, balanceOf', () => {
  expect(fnNames(MintableToken.abi)).toEqual(expect.arrayContaining(['mint', 'transfer', 'approve', 'balanceOf']))
})
test('AtomicSwap abi has swap', () => {
  expect(fnNames(AtomicSwap.abi)).toContain('swap')
})
test('bytecode is non-empty hex', () => {
  for (const c of [MintableToken, AtomicSwap, AssetToken]) expect(c.bytecode).toMatch(/^0x[0-9a-f]{100,}$/)
})

const issuer = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const other = privateKeyToAccount(`0x${'22'.repeat(32)}`)
type Account = typeof issuer

async function withAsset(
  fn: (c: {
    read: (functionName: string, args?: unknown[]) => Promise<unknown>
    send: (from: Account, functionName: string, args: unknown[]) => Promise<{status: string}>
  }) => Promise<void>,
) {
  const node = await createNode({
    chainId: 31337,
    miningConfig: {type: 'auto'},
    initialBalances: {[issuer.address]: 10n ** 21n, [other.address]: 10n ** 21n},
  })
  try {
    const transport = custom({request: ({method, params}: any) => node.request({method, params}) as any})
    const pub = createPublicClient({transport})
    const wallet = (account: Account) => createWalletClient({account, transport})
    const hash = await wallet(issuer).deployContract({
      abi: AssetToken.abi,
      bytecode: AssetToken.bytecode,
      args: ['British Pound', 'GBP', 2, 1_000_000_000n, issuer.address],
      chain: null,
    })
    const address = (await pub.waitForTransactionReceipt({hash})).contractAddress!
    const read = (functionName: string, args: unknown[] = []) =>
      pub.readContract({address, abi: AssetToken.abi, functionName, args} as any)
    const send = async (from: Account, functionName: string, args: unknown[]) => {
      // gas is fixed so a revert is mined (status 'reverted') instead of failing estimation
      const h = await wallet(from).writeContract({address, abi: AssetToken.abi, functionName, args, chain: null, gas: 200_000n} as any)
      return pub.waitForTransactionReceipt({hash: h})
    }
    await fn({read, send})
  } finally {
    await node.dispose()
  }
}

test('AssetToken: decimals, supply, issuer balance and owner from the constructor', () =>
  withAsset(async ({read}) => {
    expect(await read('decimals')).toBe(2)
    expect(await read('totalSupply')).toBe(1_000_000_000n)
    expect(await read('balanceOf', [issuer.address])).toBe(1_000_000_000n)
    expect(await read('owner')).toBe(issuer.address)
  }), 60_000)

test('AssetToken: mint is onlyOwner', () =>
  withAsset(async ({read, send}) => {
    expect((await send(other, 'mint', [other.address, 5n])).status).toBe('reverted')
    expect(await read('totalSupply')).toBe(1_000_000_000n)
    expect((await send(issuer, 'mint', [other.address, 5n])).status).toBe('success')
    expect(await read('totalSupply')).toBe(1_000_000_005n)
  }), 60_000)
