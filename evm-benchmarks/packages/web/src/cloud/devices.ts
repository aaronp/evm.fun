// The Devices panel's admin actions on a cloud chain: invite a device with a code, remove a member.
import type { Hex, LocalAccount } from 'viem'
import { joinLink } from './join'
import { GRANT_READER, GRANT_WRITER, accessTx, inviteTx, mined, type Member, type NodeClient } from '@evmb/node/src/client'

export type DeviceRole = 'reader' | 'writer'

/** Shown when a writer code can be used more than once (risk R55). */
export const multiUseWriterWarning = (role: DeviceRole, uses: number): string | undefined =>
  role === 'writer' && uses > 1 ? 'Anyone who can read this chain could see a multi-use writer code once it is used. Prefer single-use.' : undefined

/** Step-1 defaults of the invite wizard, restored for every new invite (the single link is opt-in each time). */
export const inviteDefaults = { ttl: '3600', uses: '1', role: 'reader' as DeviceRole, singleLink: false }

/** The warning beside the "single join link" checkbox. */
export const singleLinkWarning = (role: DeviceRole) =>
  `Anyone with this link can join as ${role} until it's used up or expires. Share it only somewhere private.`

/** What the invite wizard shows: a single link carries the code; otherwise a code-free link plus the code to send separately. */
export const inviteShare = (o: { base: string; nodeUrl: string; chainId: string; code: string; singleLink: boolean }): { link: string; code?: string } =>
  o.singleLink ? { link: joinLink(o.base, o.nodeUrl, o.chainId, o.code) } : { link: joinLink(o.base, o.nodeUrl, o.chainId), code: o.code.trim() }

/** Commit an invite for `code` on chain `chainId`; `client` signs as `admin`. Only the code's hash goes on chain. */
export async function inviteDevice(o: { client: NodeClient; chainId: string; admin: LocalAccount; code: string; ttlS: number; uses: number; role: DeviceRole }) {
  const { nonce, access } = await o.client.joinInfo(o.chainId)
  const grants = o.role === 'writer' ? GRANT_WRITER : GRANT_READER
  mined(await o.client.submit(o.chainId, [await inviteTx(o.admin, nonce, access, o.code.trim(), o.ttlS, o.uses, grants)]))
}

/**
 * Remove `member` from chain `chainId` in one submit (consecutive nonces): removeWriter and removeReader for a writer
 * (`nodes` lists only the highest role, and removing a role it lacks is a no-op), removeReader for a reader, then
 * setReadOpen(false) if `closeReads`. `client` signs as `admin`.
 */
export async function removeDevice(o: { client: NodeClient; chainId: string; admin: LocalAccount; member: Member; closeReads: boolean }) {
  const { member: m } = o
  if (m.role === 'admin') throw new Error("The chain's admin can't be removed")
  const { nonce, access } = await o.client.joinInfo(o.chainId)
  const calls: [Parameters<typeof accessTx>[3], Parameters<typeof accessTx>[4]][] = [
    ...(m.role === 'writer' ? [['removeWriter', m.address] as const] : []),
    ['removeReader', m.address],
    ...(o.closeReads ? [['setReadOpen', false] as const] : []),
  ]
  const txs: Hex[] = await Promise.all(calls.map(([fn, arg], i) => accessTx(o.admin, nonce + i, access, fn, arg)))
  mined(await o.client.submit(o.chainId, txs))
}
