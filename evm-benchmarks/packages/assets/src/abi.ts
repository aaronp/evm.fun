import type { Abi } from 'viem'

const ERC20_FNS = ['totalSupply', 'balanceOf', 'transfer', 'approve', 'allowance', 'decimals', 'symbol']
const fnNames = (abi: Abi) => new Set(abi.flatMap(e => (e.type === 'function' ? [e.name] : [])))

export const isErc20Abi = (abi: Abi): boolean => {
  const n = fnNames(abi)
  return ERC20_FNS.every(f => n.has(f))
}

export const isMintable = (abi: Abi): boolean =>
  abi.some(e => e.type === 'function' && e.name === 'mint' && e.inputs.map(i => i.type).join() === 'address,uint256')
