// Mint a self-issued read token for curl:  bun token.ts <chainId> <privateKey> [ttlSeconds=60]
import { privateKeyToAccount } from 'viem/accounts'
import { makeReadToken } from './src/chain'
const [chain, key, ttl = '60'] = process.argv.slice(2)
console.log(await makeReadToken(privateKeyToAccount(key as `0x${string}`), chain!, Number(ttl)))
