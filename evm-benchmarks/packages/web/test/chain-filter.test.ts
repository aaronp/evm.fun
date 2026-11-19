import { describe, test, expect } from 'bun:test'
import { filterChains } from '../src/chain/filter'
import type { ChainInfo } from '../src/chain/handle'

const c = (id: string, name: string, ephemeral?: boolean): ChainInfo => ({ id, name, type: 'plain', createdAt: '', ...(ephemeral && { ephemeral }) })
const all = [c('1', 'Demo'), c('2', 'bench run', true), c('3', 'Other demo')]

describe('filterChains', () => {
  test('empty query, all tab keeps everything in order', () => expect(filterChains(all, '', 'all')).toEqual(all))
  test('query is trimmed and case-insensitive', () => expect(filterChains(all, '  DEMO ', 'all').map(x => x.id)).toEqual(['1', '3']))
  test('saved tab drops ephemeral', () => expect(filterChains(all, '', 'saved').map(x => x.id)).toEqual(['1', '3']))
  test('bench tab keeps only ephemeral', () => expect(filterChains(all, '', 'bench').map(x => x.id)).toEqual(['2']))
  test('tab and query combine', () => expect(filterChains(all, 'other', 'bench')).toEqual([]))
})

import { rowHeight } from '../src/chain/filter'
describe('rowHeight', () => {
  test('live beats saved, saved beats dash', () => {
    expect(rowHeight({ ...all[0]!, lastHeight: 3 }, 7)).toBe('#7')
    expect(rowHeight({ ...all[0]!, lastHeight: 3 })).toBe('#3')
    expect(rowHeight(all[0]!)).toBe('—')
    expect(rowHeight(all[0]!, 0)).toBe('#0')
  })
})
