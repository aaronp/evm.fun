import { expect, test } from 'bun:test'
import { createNode } from 'webevm'
import { createPublicClient, createWalletClient, custom, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { AssetToken, AtomicSwap } from '@evmb/contracts'
import { allowances, assetId, balances, MAX_UINT256, nativeAsset, readTokenInfo, totalSupply, type Asset, type Request } from '../src'

const A = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const B = privateKeyToAccount(`0x${'22'.repeat(32)}`)
const EOA = '0x00000000000000000000000000000000000000e0' as Address

async function withToken(fn: (c: {
  request: Request; token: Asset; send: (from: typeof A, fn: string, args: unknown[]) => Promise<void>; swap: Address
}) => Promise<void>) {
  const node = await createNode({
    chainId: 31337, miningConfig: { type: 'auto' },
    initialBalances: { [A.address]: 10n ** 21n, [B.address]: 10n ** 21n },
  })
  try {
    const request: Request = (method, params) => node.request({ method, params } as any) as Promise<unknown>
    const transport = custom({ request: ({ method, params }: any) => node.request({ method, params }) as any })
    const pub = createPublicClient({ transport })
    const wallet = (account: typeof A) => createWalletClient({ account, transport })
    const deploy = async (abi: any, bytecode: any, args: unknown[]) =>
      (await pub.waitForTransactionReceipt({ hash: await wallet(A).deployContract({ abi, bytecode, args, chain: null } as any) })).contractAddress!
    const address = await deploy(AssetToken.abi, AssetToken.bytecode, ['British Pound', 'GBP', 2, 1_000_000_000n, A.address])
    const swap = await deploy(AtomicSwap.abi, AtomicSwap.bytecode, [])
    const token: Asset = {
      id: assetId('c1', address), chainId: 'c1', kind: 'erc20', address, symbol: 'GBP', name: 'British Pound',
      decimals: 2, origin: 'launched', mintable: true, addedAt: '',
    }
    const send = async (from: typeof A, functionName: string, args: unknown[]) => {
      const h = await wallet(from).writeContract({ address, abi: AssetToken.abi, functionName, args, chain: null, gas: 200_000n } as any)
      expect((await pub.waitForTransactionReceipt({ hash: h })).status).toBe('success')
    }
    await fn({ request, token, send, swap })
  } finally {
    await node.dispose()
  }
}

test('readTokenInfo reads name, symbol, decimals, supply and owner', () =>
  withToken(async ({ request, token }) => {
    expect(await readTokenInfo(request, token.address!)).toEqual({
      name: 'British Pound', symbol: 'GBP', decimals: 2, totalSupply: 1_000_000_000n, owner: A.address,
    })
  }), 60_000)

test('readTokenInfo rejects an EOA and a non-token contract', () =>
  withToken(async ({ request, swap }) => {
    await expect(readTokenInfo(request, EOA)).rejects.toThrow(`Not an ERC-20 at ${EOA}`)
    await expect(readTokenInfo(request, swap)).rejects.toThrow(`Not an ERC-20 at ${swap}`)
  }), 60_000)

test('totalSupply and balances, native and token', () =>
  withToken(async ({ request, token }) => {
    expect(await totalSupply(request, nativeAsset('c1'))).toBeUndefined()
    expect(await totalSupply(request, token)).toBe(1_000_000_000n)
    const nat = await balances(request, nativeAsset('c1'), [A.address, B.address])
    expect(nat.get(A.address)).toBe(BigInt(await request('eth_getBalance', [A.address, 'latest']) as string))
    expect(nat.get(B.address)).toBe(10n ** 21n)
    const tok = await balances(request, token, [A.address, B.address])
    expect(tok.get(A.address)).toBe(1_000_000_000n)
    expect(tok.get(B.address)).toBe(0n)
  }), 60_000)

test('allowances: spent remainder, zero drops, unlimited, native empty', () =>
  withToken(async ({ request, token, send }) => {
    expect(await allowances(request, nativeAsset('c1'))).toEqual([])
    expect(await allowances(request, token)).toEqual([])
    await send(A, 'approve', [B.address, 500n])
    await send(B, 'transferFrom', [A.address, B.address, 200n])
    expect(await allowances(request, token)).toEqual([{ owner: A.address, spender: B.address, amount: 300n }])
    await send(A, 'approve', [B.address, 0n])
    expect(await allowances(request, token)).toEqual([])
    await send(A, 'approve', [B.address, MAX_UINT256])
    expect(await allowances(request, token)).toEqual([{ owner: A.address, spender: B.address, amount: MAX_UINT256 }])
  }), 60_000)

const tokAsset = { id: 'c1:x', chainId: 'c1', kind: 'erc20', address: EOA, symbol: 'X', name: 'X', decimals: 0, origin: 'imported', mintable: false, addedAt: '' } as Asset

test('readTokenInfo: malformed address and RPC failure give "Not an ERC-20"', async () => {
  const boom: Request = async () => { throw new Error('raw rpc failure') }
  await expect(readTokenInfo(boom, 'nonsense' as Address)).rejects.toThrow('Not an ERC-20 at nonsense')
  await expect(readTokenInfo(boom, EOA)).rejects.toThrow(`Not an ERC-20 at ${EOA}`)
})

test('readTokenInfo: decimals above 255 is not a token', async () => {
  const word = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}`
  const str = (s: string) => `0x${'20'.padStart(64, '0')}${s.length.toString(16).padStart(64, '0')}${Buffer.from(s).toString('hex').padEnd(64, '0')}`
  const fake: Request = async (m, p: any) => {
    if (m === 'eth_getCode') return '0x60'
    const sel = p[0].data.slice(0, 10)
    if (sel === '0x313ce567') return word(256n) // decimals
    if (sel === '0x95d89b41') return str('X') // symbol
    return word(1n)
  }
  await expect(readTokenInfo(fake, EOA)).rejects.toThrow(`Not an ERC-20 at ${EOA}`)
})

test('allowances skips Approval-topic logs with fewer than 3 topics', async () => {
  const topic0 = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925'
  const fake: Request = async () => [{ topics: [topic0] }, { topics: [topic0, '0x' + '00'.repeat(32)] }]
  expect(await allowances(fake, tokAsset)).toEqual([])
})
