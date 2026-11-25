// An in-process worker with root and its Onboarding, for the workspace tests.
import { encodeFunctionData, keccak256, toBytes, type Abi, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ChainHost, NodeClient, ensureOnboarding, handle, issueTx, mined, setupTxs, type ChainHandleLike } from '@evmb/node'
import { createNode } from 'webevm'
import { createRevmEngine } from 'webevm/revm'
import { bunSql } from '../../node/test/bunSql'
import { wasm } from '../../node/test/workload'

export { wasm }
export const adminKey = keccak256(toBytes('w-admin')), admin = privateKeyToAccount(adminKey)
export const now = () => Math.floor(Date.now() / 1000)

/** Starts the worker (root created, Onboarding set up); `stop` in afterAll. */
export async function startWorker() {
  const hosts = new Map<string, ChainHost>()
  const chainHost = (id: string): ChainHandleLike => {
    let h = hosts.get(id)
    if (!h) hosts.set(id, (h = new ChainHost(bunSql(), wasm, { rootAdmin: admin.address, chain: chainHost })))
    return h
  }
  const srv = Bun.serve({ port: 0, fetch: (r) => handle(r, { chain: chainHost }) })
  const url = `http://localhost:${srv.port}`
  const as = (a: typeof admin) => new NodeClient(url, a)
  const node = await createNode({ chainId: 31337, computeStateRoot: true, miningConfig: { type: 'manual' }, engine: await createRevmEngine({ wasm }) })
  const dump = await node.dumpState()
  await node.dispose()
  await as(admin).createChain({ dump, setup: await setupTxs(admin, 0, 31337) })
  const { onboarding: onb, allowList } = await ensureOnboarding(as(admin), admin)
  const access = (await as(admin).health()).root!.access
  let n = 0
  /** The admin issues a fresh 1-use code, straight on root. */
  const issue = async (ttl = 600) => {
    const code = `CODE${++n}`
    const a = as(admin)
    mined(await a.submit('root', [await issueTx(admin, await a.nonce('root'), onb, code, `label ${n}`, now() + ttl, 1)]))
    return code
  }
  /** The admin sends `functionName(args)` to `to` on root (gas-free). */
  const adminCall = async (to: Address, abi: Abi, functionName: string, args: unknown[]) => {
    const a = as(admin)
    const data = encodeFunctionData({ abi, functionName, args } as never)
    mined(await a.submit('root', [await admin.signTransaction({ type: 'eip1559', chainId: 31337, nonce: await a.nonce('root'), to, data, gas: 500_000n, maxFeePerGas: 0n, maxPriorityFeePerGas: 0n })]))
  }
  return { url, onb, allowList, access, as, issue, adminCall, stop: () => srv.stop(true) }
}
