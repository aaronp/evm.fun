// Copies static runtime assets into public/ (served by vite dev, copied to dist by vite build),
// then runs the vite build unless --statics-only.
import { cp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { build } from 'vite'

const require = createRequire(import.meta.url)
const pkgDir = (p: string) => dirname(require.resolve(`${p}/package.json`))

await rm('public', { recursive: true, force: true })
await cp(join(pkgDir('solc'), 'soljson.js'), 'public/solc/soljson.js')
const oz = pkgDir('@openzeppelin/contracts')
await cp(oz, 'public/oz/@openzeppelin/contracts', {
  recursive: true,
  filter: s => {
    const rel = s.slice(oz.length)
    return !rel.includes('node_modules') && (rel === '' || !rel.split('/').pop()!.includes('.') || rel.endsWith('.sol'))
  },
})
if (!process.argv.includes('--statics-only')) await build()
