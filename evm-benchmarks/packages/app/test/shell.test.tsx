import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import { Shell } from '../src/App'
import { ProfileMenu, type ProfileProps } from '../src/shell/ProfileMenu'
import { ImportKeyDialog, NOT_A_KEY, checkPrivateKey } from '../src/keys/ImportKeyDialog'
import { FIRST_RUN, MISMATCH, UnlockDialog, confirmError } from '../src/keys/UnlockDialog'

const html = (el: React.ReactElement) => renderToString(el).replaceAll('<!-- -->', '').replaceAll('&#x27;', "'")
const me = '0x1234567890abcdef1234567890abcdef12345678' as const
const other = '0xaBcDef0000000000000000000000000000009999' as const
const noop = () => {}
const profile = (o: Partial<ProfileProps> = {}): ProfileProps =>
  ({ open: false, me, keys: [me], onToggle: noop, onChoose: noop, onGenerate: noop, onImport: noop, onLock: noop, ...o })
const shell = (o: { issuer?: boolean } = {}) => html(
  <Shell navOpen onToggleNav={noop} section="chains" onSection={noop} issuer={o.issuer ?? false} chainCount={2} profile={profile()} workerUrl="http://127.0.0.1:8799" />,
)

describe('shell', () => {
  test('shell renders the app name, nav and profile button', () => {
    const h = shell()
    expect(h).toContain('Chain workspace')
    expect(h).toContain('aria-label="Primary"')
    expect(h).toContain('aria-label="Chains"')
    expect(h).toContain('aria-label="Profile menu"')
    expect(h).toContain(me) // footer
    expect(h).not.toContain('Onboarding') // issuers only
    expect(shell({ issuer: true })).toContain('aria-label="Onboarding"')
  })

  test('profile menu lists Generate key, Import key…, Lock', () => {
    expect(html(<ProfileMenu {...profile()} />)).not.toContain('role="menu"')
    const h = html(<ProfileMenu {...profile({ open: true, keys: [me, other] })} />)
    const items = [...h.matchAll(/role="menuitem"[^>]*>([^<]*)</g)].map((m) => m[1])
    expect(items).toEqual(['Use 0xaBcD…9999', 'Generate key', 'Import key…', 'Lock'])
    expect(h).toContain('0x1234…5678')
  })

  test('import dialog rejects "0x12" with "That isn\'t a private key"', () => {
    expect(checkPrivateKey('0x12')).toBe(NOT_A_KEY)
    expect(NOT_A_KEY).toBe("That isn't a private key")
    expect(checkPrivateKey(`0x${'ab'.repeat(32)}`)).toBeNull()
    expect(checkPrivateKey(`${'ab'.repeat(32)}`)).toBe(NOT_A_KEY)
    const h = html(<ImportKeyDialog onImport={async () => {}} onClose={noop} initial={{ value: '0x12', error: checkPrivateKey('0x12')! }} />)
    expect(h).toContain('role="alert"')
    expect(h).toContain("That isn't a private key")
  })

  test('unlock dialog: the purpose as intro, first-run copy, wrong passphrase inline', () => {
    const base = { busy: false, onSubmit: noop, onCancel: noop }
    expect(html(<UnlockDialog {...base} purpose="Deploy Household" firstRun={false} error="" />)).toContain('Deploy Household')
    expect(html(<UnlockDialog {...base} purpose="generate" firstRun error="" />)).toContain(FIRST_RUN)
    expect(FIRST_RUN).toBe("It encrypts your keys in this browser; it can't be recovered.")
    expect(html(<UnlockDialog {...base} purpose="Read root" firstRun={false} error="Wrong passphrase" />)).toContain('Wrong passphrase')
  })

  test('first run asks to confirm the passphrase; a mismatch is refused', () => {
    const base = { busy: false, onSubmit: noop, onCancel: noop, error: '' }
    expect(html(<UnlockDialog {...base} purpose="generate" firstRun />)).toContain('Confirm passphrase')
    expect(html(<UnlockDialog {...base} purpose="Read root" firstRun={false} />)).not.toContain('Confirm passphrase')
    expect(confirmError('hunter2', 'hunter3')).toBe(MISMATCH)
    expect(MISMATCH).toBe("Passphrases don't match")
    expect(confirmError('hunter2', 'hunter2')).toBe('')
    expect(confirmError('hunter2', '')).toBe('') // not typed yet
  })
})
