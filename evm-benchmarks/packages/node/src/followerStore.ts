// Where a device keeps its confirmed copy of a cloud chain and its not-yet-confirmed ("pending") transactions.
import type { Address, Hex } from 'viem'
import type { SerializedState } from 'webevm'
import type { BlockSummary } from './client'

export type Outcome = { status: 'success' | 'reverted'; logs: { address: Address; topics: Hex[]; data: Hex }[] }

export type PendingTx = {
  hash: Hex; raw: Hex; from: Address; nonce: number; seq: number
  first: Outcome
  status: 'pending' | 'confirmed' | 'conflicted' | 'refused'
  block?: number; cloud?: Outcome; reason?: string; dependsOn?: Hex
}

export type Confirmed = { head: BlockSummary; dump: SerializedState }

export interface FollowerStore {
  loadConfirmed(key: string): Promise<Confirmed | undefined>
  saveConfirmed(key: string, c: Confirmed): Promise<void>
  listPending(key: string): Promise<PendingTx[]>
  putPending(key: string, tx: PendingTx): Promise<void>
  deletePending(key: string, hash: Hex): Promise<void>
}

export class MemoryFollowerStore implements FollowerStore {
  #confirmed = new Map<string, Confirmed>()
  #pending = new Map<string, Map<Hex, PendingTx>>()
  async loadConfirmed(key: string) { return this.#confirmed.get(key) }
  async saveConfirmed(key: string, c: Confirmed) { this.#confirmed.set(key, c) }
  async listPending(key: string) { return [...(this.#pending.get(key)?.values() ?? [])].sort((a, b) => a.seq - b.seq) }
  async putPending(key: string, tx: PendingTx) {
    let m = this.#pending.get(key)
    if (!m) this.#pending.set(key, (m = new Map()))
    m.set(tx.hash, tx)
  }
  async deletePending(key: string, hash: Hex) { this.#pending.get(key)?.delete(hash) }
}
