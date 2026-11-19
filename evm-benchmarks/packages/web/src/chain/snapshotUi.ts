import type { ChainSource } from './chainFile'

export const WARN_BYTES = 20 * 1024 * 1024
export const NO_FUNDS = 'None of your accounts has funds on this imported chain — create an account and fund it to send transactions.'

export const restoreBlockedReason = (pending?: number): string | null =>
  pending && pending > 0 ? `Wait for ${pending} pending transactions to settle` : null

/** Head block number of a decoded dump (validated to have a `blocks` array); 0 when it holds no blocks. */
export const dumpHeight = (dump: unknown): number => {
  const blocks = (dump as { blocks: { number: number | bigint }[] }).blocks
  return blocks.length ? Number(blocks[blocks.length - 1]!.number) : 0
}

/** Built here from the real file name and dump; a `source` inside the file is never trusted. */
export const importSource = (fileName: string, dump: unknown): ChainSource => ({ kind: 'import', fileName, height: dumpHeight(dump) })

export const sizeKb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('en-US')} KB`
