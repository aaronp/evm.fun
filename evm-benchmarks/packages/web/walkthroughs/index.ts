import type { Walkthrough } from '../src/walkthrough/types'
import gbpUsd from './gbp-usd.json'
import takeWithoutApproval from './take-without-approval.json'

// Validated by test/walkthrough-format.test.ts, so a cast is enough here.
export const bundled = [gbpUsd, takeWithoutApproval] as unknown as Walkthrough[]
