import { getAddress, isAddress, isHex, size } from 'viem'
import type { AbiParameter } from 'viem'

export type Parsed = { ok: true; value: unknown } | { ok: false; error: string }
const fail = (error: string): Parsed => ({ ok: false, error })

/** Parse one user-typed argument. Arrays take JSON; integers always come back as bigint. */
export function parseArg(type: string, input: string): Parsed {
  const s = input.trim()
  const arr = type.match(/^(.*)\[(\d*)\]$/)
  if (arr) {
    let j: unknown
    // quote bare numbers first so integers never pass through a JS double
    try { j = JSON.parse(s.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, m => (m[0] === '"' ? m : `"${m}"`))) } catch { return fail(`${type} expects a JSON array, e.g. [1,2]`) }
    if (!Array.isArray(j)) return fail(`${type} expects a JSON array`)
    if (arr[2] && j.length !== +arr[2]) return fail(`${type} expects ${arr[2]} elements`)
    const out: unknown[] = []
    for (const [i, el] of j.entries()) {
      const r = parseArg(arr[1]!, typeof el === 'string' ? el : JSON.stringify(el))
      if (!r.ok) return fail(`[${i}]: ${r.error}`)
      out.push(r.value)
    }
    return { ok: true, value: out }
  }
  if (type === 'string') return { ok: true, value: input }
  if (type === 'address') {
    return isAddress(s, { strict: false }) ? { ok: true, value: getAddress(s.toLowerCase()) } : fail(`"${s}" is not a valid address`)
  }
  if (type === 'bool') return s === 'true' || s === 'false' ? { ok: true, value: s === 'true' } : fail('expected true or false')
  const int = type.match(/^(u?)int(\d*)$/)
  if (int) {
    const bits = BigInt(int[2] || 256)
    if (!(int[1] ? /^\d+$/ : /^-?\d+$/).test(s)) return fail(`"${s}" is not ${int[1] ? 'a non-negative' : 'an'} integer`)
    const n = BigInt(s)
    const [lo, hi] = int[1] ? [0n, (1n << bits) - 1n] : [-(1n << (bits - 1n)), (1n << (bits - 1n)) - 1n]
    return n < lo || n > hi ? fail(`${s} does not fit in ${type}`) : { ok: true, value: n }
  }
  const by = type.match(/^bytes(\d*)$/)
  if (by) {
    if (!isHex(s, { strict: true }) || s.length % 2) return fail(`"${s}" is not valid hex bytes`)
    if (by[1] && size(s) !== +by[1]) return fail(`${type} needs exactly ${by[1]} bytes`)
    return { ok: true, value: s }
  }
  return fail(`Unsupported argument type: ${type}`)
}

/** Parse every input; collects all errors rather than stopping at the first. */
export function encodeArgs(inputs: readonly AbiParameter[], raw: string[]): { ok: true; values: unknown[] } | { ok: false; errors: string[] } {
  const values: unknown[] = []
  const errors: string[] = []
  inputs.forEach((p, i) => {
    const r = parseArg(p.type, raw[i] ?? '')
    if (r.ok) values.push(r.value)
    else errors.push(`${p.name || `arg${i}`} (${p.type}): ${r.error}`)
  })
  return errors.length ? { ok: false, errors } : { ok: true, values }
}
