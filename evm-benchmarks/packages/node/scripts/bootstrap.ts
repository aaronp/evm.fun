// Create the root chain on a worker: bun packages/node/scripts/bootstrap.ts <url> <envfile>
// Reads ROOT_ADMIN_KEY from <envfile>, generating and saving one if missing. Creates root if missing, then its Onboarding if missing.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createNode, type SerializedState } from 'webevm'
import { createRevmEngine } from 'webevm/revm'
import { NodeClient, setupTxs } from '../src/client'
import { ensureOnboarding } from '../src/onboarding'

export const wasm = readFileSync(require.resolve('revm-wasm/revm.wasm'))

/** ROOT_ADMIN_KEY from `file` (KEY=value lines), generated and appended if missing. */
export function ensureKey(file: string): { key: Hex; generated: boolean } {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const found = text.match(/^ROOT_ADMIN_KEY=(0x[0-9a-fA-F]{64})\s*$/m)?.[1]
  if (found) return { key: found as Hex, generated: false }
  const key = generatePrivateKey()
  writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}ROOT_ADMIN_KEY=${key}\n`)
  chmodSync(file, 0o600)
  console.log(`ROOT_ADMIN_KEY generated, saved to ${basename(file)}. Import this key in evm.fun (Accounts → Import) to issue codes.`)
  return { key, generated: true }
}

/** A fresh webevm chain (chainId 31337, roots on, gas-free) with `txs` mined as block 1 if any; its dump. */
export async function freshDump(txs: Hex[] = []): Promise<SerializedState> {
  const node = await createNode({
    chainId: 31337, computeStateRoot: true, miningConfig: { type: 'manual' }, blockEnv: { baseFeePerGas: 0n },
    genesisTimestamp: BigInt(Math.floor(Date.now() / 1000)), engine: await createRevmEngine({ wasm }),
  })
  try {
    for (const raw of txs) await node.request({ method: 'eth_sendRawTransaction', params: [raw] })
    if (txs.length) await node.mine()
    return await node.dumpState()
  } finally {
    await node.dispose()
  }
}

export async function bootstrap(url: string, envFile: string) {
  const admin = privateKeyToAccount(ensureKey(envFile).key)
  const client = new NodeClient(url, admin)
  let { root } = await client.health()
  if (!root) {
    await client.createChain({ dump: await freshDump(), setup: await setupTxs(admin, 0, 31337) })
    root = (await client.health()).root
    console.log('root chain created')
  }
  const { onboarding } = await ensureOnboarding(client, admin)
  console.log(`root chain: admin ${root!.admin}, ChainAccess ${root!.access}, Onboarding ${onboarding}, head #${(await client.health()).root!.head}`)
}

if (import.meta.main) {
  const [url, envFile] = process.argv.slice(2)
  if (!url || !envFile) throw new Error('usage: bootstrap.ts <url> <envfile>')
  await bootstrap(url, envFile)
}
