import { getAddress, type Address } from 'viem'

/** Who may submit to / read a chain. Tx senders inside a block are not the ACL's concern; contracts decide those. */
export interface ACL {
  /** `write` = admin + writers; `deploy` = admin + deployers (= `write` on a chain whose ChainAccess predates the role); `read` = write + readers (members only: `readOpen` is reported, not expanded). */
  list(): Promise<{ write: Address[]; read: Address[]; deploy: Address[]; deployRole: boolean; readOpen: boolean }>
  canWrite(a: Address): Promise<boolean>
  /** May submit contract creations. */
  canDeploy(a: Address): Promise<boolean>
  canRead(a: Address): Promise<boolean>
}

const uniq = (xs: string[]) => [...new Set(xs.map((x) => getAddress(x)))]

/** An old ChainAccess has no canDeploy/deployers: no fallback function, so the call reverts with no data (or decodes none). Anything else is a real failure. */
const absent = (e: unknown) => /^execution reverted$|returned no data/.test(e instanceof Error ? e.message : String(e))

/** ACL over the chain's `ChainAccess` contract; `call` runs a view function on it. */
export function chainAcl(call: (fn: string, args?: unknown[]) => Promise<unknown>): ACL {
  return {
    async list() {
      const [admin, readOpen, writers, readers] = await Promise.all([call('admin'), call('readOpen'), call('writers'), call('readers')]) as [Address, boolean, Address[], Address[]]
      const write = uniq([admin, ...writers])
      let deployRole = true // false on an old ChainAccess: no deployers, writers deploy
      const deploy = await call('deployers').then((d) => uniq([admin, ...(d as Address[])]), (e) => { if (absent(e)) { deployRole = false; return write } throw e })
      return { write, read: uniq([...write, ...readers]), deploy, deployRole, readOpen }
    },
    canWrite: (a) => call('canWrite', [a]) as Promise<boolean>,
    // an old ChainAccess has no canDeploy: its writers deploy
    canDeploy: (a) => (call('canDeploy', [a]) as Promise<boolean>).catch((e) => { if (absent(e)) return call('canWrite', [a]) as Promise<boolean>; throw e }),
    canRead: (a) => call('canRead', [a]) as Promise<boolean>,
  }
}
