import type { Abi, Address } from 'viem'
import { assetId, isErc20Abi, isMintable, type Asset } from '@evmb/assets'
import { MAX_NAME } from '../chain/chainFile'

type Info = { symbol: string; name: string; decimals: number }

/** The one place a token record is built: text clipped to what chain files accept, id and addedAt filled in. */
export const tokenAsset = (
  chainId: string, address: Address, info: Info,
  o: { origin: Asset['origin']; issuer?: Address; mintable: boolean },
): Asset => ({
  id: assetId(chainId, address), chainId, kind: 'erc20', address,
  symbol: info.symbol.slice(0, MAX_NAME), name: info.name.slice(0, MAX_NAME), decimals: info.decimals,
  origin: o.origin, issuer: o.issuer, mintable: o.mintable, addedAt: new Date().toISOString(),
})

/** Adopt already-deployed ERC-20 contract records as assets. A record that can't be read is skipped. */
export async function reconcileAssets(
  chainId: string,
  contracts: { address: Address; abi: any[]; deployer: Address }[],
  registry: { list(chainId: string): Promise<Asset[]>; add(a: Asset): Promise<void> },
  read: (address: Address) => Promise<Info>,
) {
  const known = new Set((await registry.list(chainId)).map(a => a.id))
  for (const c of contracts) {
    if (!isErc20Abi(c.abi as Abi) || known.has(assetId(chainId, c.address))) continue
    try {
      await registry.add(tokenAsset(chainId, c.address, await read(c.address), { origin: 'deployed', issuer: c.deployer, mintable: isMintable(c.abi as Abi) }))
    } catch { /* one unreadable record doesn't stop the rest */ }
  }
}
