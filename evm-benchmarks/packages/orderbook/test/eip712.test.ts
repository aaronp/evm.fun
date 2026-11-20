import { expect, test } from 'bun:test'
import { createNode } from 'webevm'
import { createPublicClient, createWalletClient, custom, getAddress, recoverTypedDataAddress, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { AssetToken, Settlement } from '@evmb/contracts'
import { domainOf, hashOrder, orderTypes, signOrder, type SignedOrder, type Wallet } from '../src'

const maker = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const taker = privateKeyToAccount(`0x${'22'.repeat(32)}`)
const walletOf = (a: typeof maker): Wallet => ({
  address: a.address,
  signTypedData: td => a.signTypedData(td),
  sendTransaction: () => { throw new Error('not used') },
})

test('hashOrder matches the contract; signOrder signs what settle accepts', async () => {
  const node = await createNode({
    chainId: 31337, miningConfig: { type: 'auto' },
    initialBalances: { [maker.address]: 10n ** 21n, [taker.address]: 10n ** 21n },
  })
  try {
    const transport = custom({ request: ({ method, params }: any) => node.request({ method, params }) as any })
    const pub = createPublicClient({ transport })
    const send = async (from: typeof maker, tx: any) =>
      pub.waitForTransactionReceipt({ hash: await createWalletClient({ account: from, transport }).writeContract({ chain: null, gas: 3_000_000n, ...tx }) })
    const deploy = async (c: { abi: any; bytecode: `0x${string}` }, args: unknown[]) => {
      const hash = await createWalletClient({ account: maker, transport }).deployContract({ abi: c.abi, bytecode: c.bytecode, args, chain: null })
      return getAddress((await pub.waitForTransactionReceipt({ hash })).contractAddress!)
    }
    const gbp = await deploy(AssetToken, ['British Pound', 'GBP', 2, 100_000n, maker.address])
    const usd = await deploy(AssetToken, ['US Dollar', 'USD', 6, 10n ** 12n, taker.address])
    const settlement = await deploy(Settlement, [])
    for (const [who, t] of [[maker, gbp], [taker, usd]] as const)
      await send(who, { address: t, abi: AssetToken.abi, functionName: 'approve', args: [settlement, 2n ** 255n] })

    const domain = domainOf(31337, settlement)
    const o: SignedOrder = { maker: maker.address, base: gbp, quote: usd, side: 1, price: 1_270_000n, amount: 500n, nonce: 9n, expiry: 2n ** 40n }
    expect(hashOrder(o, domain)).toBe(await pub.readContract({ address: settlement, abi: Settlement.abi, functionName: 'hashOrder', args: [o] }) as any)

    const sig = await signOrder(walletOf(maker), o, domain)
    expect(await recoverTypedDataAddress({ domain, types: orderTypes, primaryType: 'Order', message: o, signature: sig })).toBe(maker.address)
    const r = await send(taker, { address: settlement, abi: Settlement.abi, functionName: 'settle', args: [[o], [sig], [200n]] })
    expect(r.status).toBe('success')
    const bal = (t: Address, who: Address) => pub.readContract({ address: t, abi: AssetToken.abi, functionName: 'balanceOf', args: [who] })
    expect(await bal(gbp, taker.address)).toBe(200n)
    expect(await bal(usd, maker.address)).toBe(2_540_000n)
  } finally {
    await node.dispose()
  }
}, 60_000)
