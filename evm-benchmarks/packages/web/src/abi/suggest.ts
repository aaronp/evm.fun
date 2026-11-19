export type Suggestion = { value: `0x${string}`; label: string }

/** Accounts first, then contracts; deduped by lowercase address (first wins). */
export function addressSuggestions(
  accounts: { label: string; address: `0x${string}` }[],
  contracts: { name: string; address: `0x${string}` }[],
): Suggestion[] {
  const seen = new Set<string>()
  return [
    ...accounts.map(a => ({ value: a.address, label: a.label })),
    ...contracts.map(c => ({ value: c.address, label: c.name })),
  ].filter(s => !seen.has(s.value.toLowerCase()) && !!seen.add(s.value.toLowerCase()))
}
