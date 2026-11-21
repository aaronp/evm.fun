import type { Walkthrough } from '../src/walkthrough/types'
import gbpUsd from './gbp-usd.json'
import takeWithoutApproval from './take-without-approval.json'
import bookOnchain from './gbp-usd-book-onchain.json'
import bookOffchain from './gbp-usd-book-offchain.json'
import pool from './gbp-usd-pool.json'

// Validated by test/walkthrough-format.test.ts, so a cast is enough here.
export const bundled = [gbpUsd, takeWithoutApproval, bookOnchain, bookOffchain, pool] as unknown as Walkthrough[]
