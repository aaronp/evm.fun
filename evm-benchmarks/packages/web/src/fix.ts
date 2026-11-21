import { formatUnits } from 'viem'
import type { Asset } from '@evmb/assets'
import { personaParam, resolvePersona, safeBack, withParams } from './links'

/** A one-click fix for an error: a link to the page that fixes it. */
export type Fix = { label: string; href: string }
type Persona = { label: string; address: string }
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** "Request {amount} {SYM} from {issuer}": the Assets page's Send dialog acting as `issuer`, prefilled with `recipient`
 *  and the exact shortfall, coming `back` after. Only when the issuer is one of this browser's accounts (we sign with
 *  their key), isn't the recipient, and holds at least the shortfall (`issuerHas`). */
export function requestFix({ chainId, asset, issuer, recipient, need, have, issuerHas, back, accounts }: {
  chainId: string; asset: Asset; issuer?: string; recipient: string; need: bigint; have: bigint
  issuerHas?: bigint; back: string; accounts: Persona[]
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
      back: withParams(back, { chain: chainId, as: personaParam(recipient, accounts) }),
    }),
  }
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
