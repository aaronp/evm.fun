// Root's Onboarding read from a synced root Follower: who issues, and the codes with their grants.
import { decodeErrorResult, decodeFunctionResult, encodeFunctionData, zeroAddress, type Abi, type Address, type Hex } from 'viem'
import { AllowList, Onboarding } from '@evmb/contracts'
import type { Follower } from '@evmb/node'

export type CodeView = {
  hash: Hex; label: string; issuer: Address; issuedAt: number; expiresAt: number; uses: number; usesLeft: number
  status: 'active' | 'used' | 'expired' | 'revoked'; grants: { by: Address; chainId: string; at: number }[]
}

/** eth_call `functionName` on root's local copy as `from`; a revert throws its reason. */
async function call<A>(f: Follower, from: Address, to: Address, abi: Abi, functionName: string, args: unknown[] = []): Promise<A> {
  const data = encodeFunctionData({ abi, functionName, args } as never)
  const out = await f.read((n) => n.request({ method: 'eth_call', params: [{ from, to, data }, 'latest'] })) as Hex
  return decodeFunctionResult({ abi, functionName, data: out } as never) as A
}

/** Run `data` against root's copy as `from` first, so a revert's reason is thrown before anything is sent. */
export async function simulate(f: Follower, from: Address, to: Address, data: Hex): Promise<void> {
  try {
    await f.read((n) => n.request({ method: 'eth_call', params: [{ from, to, data }, 'latest'] }))
  } catch (e) {
    // the node's RpcError carries the revert data; Error(string) → its reason
    const revert = (e as { data?: unknown }).data
    let reason: unknown
    try { if (typeof revert === 'string' && revert.length > 2) reason = decodeErrorResult({ data: revert as Hex }).args?.[0] } catch {}
    throw typeof reason === 'string' ? new Error(reason, { cause: e }) : e
  }
}

export async function isIssuerOn(f: Follower, onboarding: Address, me: Address): Promise<boolean> {
  const issuers = await call<Address>(f, me, onboarding, Onboarding.abi as Abi, 'issuers')
  return call<boolean>(f, me, issuers, AllowList.abi as Abi, 'allows', [me, '0x00000000000000000000000000000000', zeroAddress])
}

type Code = { hash: Hex; label: string; issuer: Address; issuedAt: bigint; expiresAt: bigint; uses: number; usesLeft: number; revoked: boolean }
type Grant = { by: Address; chainId: string; at: bigint }

/** Every code, newest first; status by precedence revoked > used > expired > active. */
export async function readCodes(f: Follower, onboarding: Address, me: Address, now = Date.now() / 1000): Promise<CodeView[]> {
  const codes = await call<Code[]>(f, me, onboarding, Onboarding.abi as Abi, 'codes')
  return Promise.all(codes.toReversed().map(async (c) => {
    const grants = await call<Grant[]>(f, me, onboarding, Onboarding.abi as Abi, 'grants', [c.hash])
    const expiresAt = Number(c.expiresAt)
    return {
      hash: c.hash, label: c.label, issuer: c.issuer, issuedAt: Number(c.issuedAt), expiresAt, uses: c.uses, usesLeft: c.usesLeft,
      status: c.revoked ? 'revoked' : c.usesLeft === 0 ? 'used' : now > expiresAt ? 'expired' : 'active',
      grants: grants.map((g) => ({ by: g.by, chainId: g.chainId, at: Number(g.at) })),
    }
  }))
}
