import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import type { ChainRecord } from '@evmb/workspace'
import { afterCreate, checkChainName, codeFromSearch, linkDialog, refusalCopy } from '../src/chains/view'
import { App } from '../src/App'
import { Modal } from '../src/shell/Modal'
import { Ctx, type AppState } from '../src/state'
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

  test('?code= link: App opens New chain and creates nothing; after create, Deploy opens with "205 117"', () => {
    const g = globalThis as { location?: unknown }
    const created: string[] = []
    const workspace = { chains: () => [], onChange: () => noop, createChain: async (n: string) => { created.push(n); throw new Error('unused') } }
    const state = { workerUrl: 'http://127.0.0.1:8799', held: [], issuer: false, workspace, setNotice: noop } as unknown as AppState
    g.location = { search: '?code=205117', href: 'http://localhost:5174/?code=205117' }
    try {
      const h = html(<Ctx.Provider value={state}><App /></Ctx.Provider>)
      expect(h).toContain('role="dialog"')
      expect(h).toContain('It starts local, in this browser. You can deploy it later.')
      expect(created).toEqual([])
    } finally { delete g.location }
    // the App's transitions: start, then after the user creates chain "c1"
    expect(linkDialog(codeFromSearch('?code=205117'))).toEqual({ kind: 'new' })
    expect(linkDialog(codeFromSearch(''))).toBeUndefined()
    const next = afterCreate(codeFromSearch('?code=205117'), 'c1')
    expect(next).toEqual({ kind: 'deploy', id: 'c1', code: '205 117' })
    expect(afterCreate(undefined, 'c1')).toBeUndefined()
    const d = html(<DeployModal chain={chain({ id: 'c1' })} issuer={false} initialCode={next?.kind === 'deploy' ? next.code : undefined} onDeploy={async () => {}} onClose={noop} />)
    expect(d).toContain('value="205 117"')
  })

  test('a modal that can\'t close (deploy in flight) disables Close and Cancel', () => {
    const m = (canClose?: boolean) => html(<Modal title="t" intro="i" confirmLabel="Go" canConfirm={false} canClose={canClose} onConfirm={noop} onClose={noop} />)
    expect([...m(false).matchAll(/<button type="button"[^>]*disabled/g)].length).toBe(2)
    expect(m()).not.toMatch(/<button type="button"[^>]*disabled/)
  })

  test('general: name and description are editable with Save changes; a rename may keep its own name', () => {
    const h = html(<ChainDetail chain={chain({ desc: 'Bills' })} onSave={async () => {}} onDeploy={noop} onRetry={noop} />)
    expect(h).toContain('value="Household ledger"')
    expect(h).toContain('value="Bills"')
    expect(h).toContain('>Save changes<')
    expect(h).not.toMatch(/<input[^>]*disabled/)
    expect(checkChainName([chain()], 'household ledger', chain().id)).toBeNull()
    expect(checkChainName([chain()], 'household ledger')).toBe('You already have a chain called “household ledger”.')
  })

  test('unfinished shows Retry', () => {
    const h = html(<ChainDetail chain={chain({ status: 'unfinished', error: 'create failed' })} onSave={async () => {}} onDeploy={noop} onRetry={noop} />)
    expect(h).toContain("Your code was accepted but the chain wasn't created: create failed")
    expect(h).toContain('>Retry<')
    expect(h).not.toContain('Deploy chain…')
    const l = html(<ChainDetail chain={chain()} onSave={async () => {}} onDeploy={noop} onRetry={noop} />)
    expect(l).toContain('Local only')
    expect(l).toContain('Deploy chain…')
    const d = html(<ChainDetail chain={chain({ status: 'deployed', deployedAt: Date.now() })} onSave={async () => {}} onDeploy={noop} onRetry={noop} />)
    expect(d).toContain('Deployed and syncing')
    expect(d).toContain('Deployed just now')
    expect(d).toContain('You: Admin')
  })
})
