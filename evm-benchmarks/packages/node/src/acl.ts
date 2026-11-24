import { getAddress, type Address } from 'viem'

/** Who may submit to / read a chain. Tx senders inside a block are not the ACL's concern; contracts decide those. */
export interface ACL {
  /** `write` = admin + writers; `deploy` = admin + deployers (= `write` on a chain whose ChainAccess predates the role); `read` = write + readers (members only: `readOpen` is reported, not expanded). */
  list(): Promise<{ write: Address[]; read: Address[]; deploy: Address[]; readOpen: boolean }>
  canWrite(a: Address): Promise<boolean>
  /** May submit contract creations. */
  canDeploy(a: Address): Promise<boolean>
  canRead(a: Address): Promise<boolean>
}

const uniq = (xs: string[]) => [...new Set(xs.map((x) => getAddress(x)))]

/** ACL over the chain's `ChainAccess` contract; `call` runs a view function on it. */
export function chainAcl(call: (fn: string, args?: unknown[]) => Promise<unknown>): ACL {
  return {
    async list() {
      const [admin, readOpen, writers, readers] = await Promise.all([call('admin'), call('readOpen'), call('writers'), call('readers')]) as [Address, boolean, Address[], Address[]]
      const write = uniq([admin, ...writers])
      const deploy = await call('deployers').then((d) => uniq([admin, ...(d as Address[])]), () => write)
      return { write, read: uniq([...write, ...readers]), deploy, readOpen }
    },
    canWrite: (a) => call('canWrite', [a]) as Promise<boolean>,
    // an old ChainAccess has no canDeploy: its writers deploy
    canDeploy: (a) => (call('canDeploy', [a]) as Promise<boolean>).catch(() => call('canWrite', [a]) as Promise<boolean>),
    canRead: (a) => call('canRead', [a]) as Promise<boolean>,
  }
}
