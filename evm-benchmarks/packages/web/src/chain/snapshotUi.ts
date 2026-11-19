import { MAX_NAME, type ChainSource } from './chainFile'

export const WARN_BYTES = 20 * 1024 * 1024
export const NO_FUNDS = 'None of your accounts has funds on this imported chain — create an account and fund it to send transactions.'

export const NO_SNAPSHOT = "This chain type can't be snapshotted"

export const restoreBlockedReason = (pending?: number): string | null =>
  pending && pending > 0 ? `Wait for ${pending} pending transactions to settle` : null

/** Head block number of a decoded dump (validated to have a `blocks` array); 0 when it holds no blocks. */
export const dumpHeight = (dump: unknown): number => {
  const blocks = (dump as { blocks: { number: number | bigint }[] }).blocks
  return blocks.length ? Number(blocks[blocks.length - 1]!.number) : 0
}

/** Built here from the real file name (clamped to MAX_NAME so the chain re-exports) and dump; a `source` inside the file is never trusted. */
export const importSource = (fileName: string, dump: unknown): ChainSource => ({ kind: 'import', fileName: fileName.slice(0, MAX_NAME), height: dumpHeight(dump) })

export const sizeKb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('en-US')} KB`

/** "<snapshot> (fork)", clamped so the fork's name still fits an import. */
export const forkName = (snapshotName: string) => snapshotName.slice(0, MAX_NAME - ' (fork)'.length) + ' (fork)'
