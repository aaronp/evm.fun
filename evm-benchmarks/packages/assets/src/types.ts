import type { Address } from 'viem'

export type AssetId = string
export type Asset = {
  id: AssetId
  /** The playground ChainInfo.id (a UUID), not the EVM chain id. */
  chainId: string
  kind: 'native' | 'erc20'
  address?: Address
  symbol: string
  name: string
  decimals: number
  origin: 'native' | 'launched' | 'imported' | 'deployed'
  issuer?: Address
  mintable: boolean
  addedAt: string
}
