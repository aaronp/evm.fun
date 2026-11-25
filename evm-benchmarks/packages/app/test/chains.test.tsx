import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import type { ChainRecord } from '@evmb/workspace'
import { codeFromSearch, refusalCopy } from '../src/chains/view'
import { ChainList } from '../src/chains/ChainList'
import { ChainDetail } from '../src/chains/ChainDetail'
import { DeployModal } from '../src/chains/DeployModal'

const html = (el: React.ReactElement) => renderToString(el).replaceAll('<!-- -->', '').replaceAll('&#x27;', "'")
const noop = () => {}
const chain = (o: Partial<ChainRecord> = {}): ChainRecord =>
  ({ id: '0e7a1f52-3c1d-4f7e-9a0b-6f2d8c4b1a90', name: 'Household ledger', desc: '', createdAt: 0, status: 'local', ...o })

describe('chains', () => {
  test('view: refusal reason → copy', () => {
    expect(refusalCopy('code expired')).toBe('That code has expired. Ask for a new one.')
    expect(refusalCopy('code used up')).toBe('That code has no deployments left.')
    expect(refusalCopy('code revoked')).toBe('That code was revoked.')
    expect(refusalCopy('no such code')).toBe("That code isn't valid. Check it and try again.")
    expect(refusalCopy('bad code')).toBe("That code isn't valid. Check it and try again.")
    expect(refusalCopy('worker down')).toBe('worker down') // unknown: as given
  })

  test('chain list renders local and deployed chains with their badges', () => {
    const h = html(<ChainList chains={[chain(), chain({ id: 'b', name: 'Team escrow', status: 'deployed', deployedAt: 0 })]} selected="b" onPick={noop} onNew={noop} />)
    expect(h).toContain('New chain')
    expect(h).toContain('Your chains')
    expect(h).toContain('Household ledger')
    expect(h).toContain('Local · Admin')
    expect(h).toContain('Team escrow')
    expect(h).toContain('Deployed · Admin')
    expect(h).toContain('aria-current="true"')
    expect(html(<ChainList chains={[]} onPick={noop} onNew={noop} />)).toContain('No chains yet')
  })

  test('deploy modal hides Vouch for non-issuers', () => {
    const base = { chain: chain(), onDeploy: async () => {}, onClose: noop }
    const h = html(<DeployModal {...base} issuer={false} />)
    expect(h).toContain('Someone gave me a code')
    expect(h).toContain('An admin issued you a code.')
    expect(h).not.toContain('Vouch')
    const i = html(<DeployModal {...base} issuer initialMode="vouch" />)
    expect(i).toContain('Vouch')
    expect([...i.matchAll(/<option[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual(['Root'])
  })

  test('?code=205117 pre-fills "205 117" in the deploy modal', () => {
    expect(codeFromSearch('?code=205117')).toBe('205 117')
    expect(codeFromSearch('?code=let-sue-in')).toBe('LETSUEIN')
    expect(codeFromSearch('')).toBeUndefined()
    const h = html(<DeployModal chain={chain()} issuer={false} initialCode={codeFromSearch('?code=205117')} onDeploy={async () => {}} onClose={noop} />)
    expect(h).toContain('value="205 117"')
  })

  test('unfinished shows Retry', () => {
    const h = html(<ChainDetail chain={chain({ status: 'unfinished', error: 'create failed' })} onDeploy={noop} onRetry={noop} />)
    expect(h).toContain("Your code was accepted but the chain wasn't created: create failed")
    expect(h).toContain('>Retry<')
    expect(h).not.toContain('Deploy chain…')
    const l = html(<ChainDetail chain={chain()} onDeploy={noop} onRetry={noop} />)
    expect(l).toContain('Local only')
    expect(l).toContain('Deploy chain…')
    const d = html(<ChainDetail chain={chain({ status: 'deployed', deployedAt: Date.now() })} onDeploy={noop} onRetry={noop} />)
    expect(d).toContain('Deployed and syncing')
    expect(d).toContain('Deployed just now')
    expect(d).toContain('You: Admin')
  })
})
