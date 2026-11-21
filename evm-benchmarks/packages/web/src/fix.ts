import { formatUnits } from 'viem'
import { nativeAsset, type Asset } from '@evmb/assets'
import type { GasShortfall } from './tx/send'
import { personaParam, resolvePersona, safeBack, withParams } from './links'

/** A one-click fix for an error: a link to the page that fixes it. */
export type Fix = { label: string; href: string }
type Persona = { label: string; address: string }
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** "Request {amount} {SYM} from {issuer}": the Assets page's Send dialog acting as `issuer`, prefilled with `recipient`
 *  and the exact shortfall, coming `back` after. Only when the issuer is one of this browser's accounts (we sign with
 *  their key), isn't the recipient, and holds at least the shortfall (`issuerHas`). */
export function requestFix({ chainId, asset, issuer, recipient, need, have, issuerHas, back, accounts, backChain = chainId }: {
  chainId: string; asset: Asset; issuer?: string; recipient: string; need: bigint; have: bigint
  issuerHas?: bigint; back: string; accounts: Persona[]
  /** the chain to come back to (the page's selected chain) when the shortfall is on another one (xswap's chain B) */
  backChain?: string
}): Fix | undefined {
  const short = need - have
  const from = issuer && accounts.find(a => eq(a.address, issuer))
  if (short <= 0n || !from || eq(from.address, recipient) || issuerHas === undefined || issuerHas < short) return
  const amount = formatUnits(short, asset.decimals)
  return {
    label: `Request ${amount} ${asset.symbol} from ${from.label}`,
    href: withParams('/assets', {
      chain: chainId, as: personaParam(from.address, accounts), asset: asset.id, send: recipient, amount,
      // the way back restores this chain and the recipient as the persona, even if the address hadn't caught up yet
      back: withParams(back, { chain: backChain, as: personaParam(recipient, accounts) }),
    }),
  }
}

const CENT = 10n ** 16n // 0.01 ETH
const FEE_MARGIN = 3_000_000n * 2_000_000_000n // the payer's own Send gas: the pre-check's fallback limit at 2 gwei

/** "Request {amount} ETH from {account}" for a sender with no ETH for fees: the Assets page's native Send acting as
 *  the local account (not the sender) with the most ETH. Amount: the known shortfall rounded up to 0.01 ETH, else 1 ETH;
 *  none when no other account holds more than that (it pays fees for the Send too). */
export function gasFix({ chainId, shortfall, balances, back, accounts, backChain }: {
  chainId: string; shortfall: GasShortfall; balances: Map<string, bigint>; back: string; accounts: Persona[]; backChain?: string
}): Fix | undefined {
  const short = (shortfall.need ?? 0n) - (shortfall.have ?? 0n)
  const amount = short > 0n ? (short + CENT - 1n) / CENT * CENT : 10n ** 18n
  let rich: Persona | undefined, most = amount + FEE_MARGIN
  for (const a of accounts) {
    const has = balances.get(a.address) ?? 0n
    if (!eq(a.address, shortfall.address) && has > most) { rich = a; most = has }
  }
  return rich && requestFix({ chainId, asset: nativeAsset(chainId), issuer: rich.address, recipient: shortfall.address, need: amount, have: 0n, issuerHas: most, back, accounts, backChain })
}

/** The Send a request link asks for (`?as=&asset=&send=&amount=&back=`): `from` must be one of this browser's
 *  accounts; `back` only when it's an in-app path. `to`/`amount` are passed as given (the dialog validates them). */
export function linkedSend<P extends Persona>(sp: URLSearchParams, accounts: P[]) {
  const to = sp.get('send'), as = sp.get('as')
  const addr = to && as ? resolvePersona(as, accounts) : undefined
  const from = addr && accounts.find(a => a.address === addr)
  if (!from) return
  return { from, asset: sp.get('asset') ?? undefined, to: to!, amount: sp.get('amount') ?? '', back: safeBack(sp.get('back')) }
}
