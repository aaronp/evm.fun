import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem'
import type { SignedOrder } from './eip712'
import type { Side } from './types'

/** The parts of OrderBook.sol's ABI the package uses (tested against the compiled artifact), plus ERC-20's. */
export const orderBookAbi = parseAbi([
  'struct Order { address owner; address base; address quote; uint8 side; uint8 status; uint64 closedBlock; uint256 price; uint256 amount; uint256 filled; }',
  'function place(address base, address quote, uint8 side, uint256 price, uint256 amount, uint256 maxLevels, uint256 hint, bool rest) returns (uint256 id)',
  'function cancel(uint256 id)',
  'function orders(uint256 id) view returns (Order)',
  'function ordersOf(address owner) view returns (uint256[])',
  'function best(address base, address quote, uint8 side) view returns (uint256 price)',
  'function level(address base, address quote, uint8 side, uint256 price) view returns (uint256 prev, uint256 next, uint256 size, uint256 count)',
  'function levelOrders(address base, address quote, uint8 side, uint256 price) view returns (uint256[] out)',
  'event OrderPlaced(uint256 indexed id, address indexed owner, address base, address quote, uint8 side, uint256 price, uint256 amount)',
  'event Trade(uint256 indexed makerId, uint256 indexed takerId, address maker, address taker, uint256 price, uint256 amount, uint256 quoteAmount)',
  'event OrderCancelled(uint256 indexed id)',
  'error OrderNotOpen(uint256 id, uint8 status)',
  'error NotOwner(uint256 id)',
  'error BadOrder()',
  'error BookTooThin(uint256 filled)',
  'error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)',
  'error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)',
])
export const erc20Abi = parseAbi([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
])

export const sideNum = (s: Side) => (s === 'buy' ? 0 : 1)
type Call = { to: Address; data: Hex }
export type PlaceArgs = { base: Address; quote: Address; side: Side; price: bigint; amount: bigint; maxLevels: number; hint: bigint; rest: boolean }

export const placeCall = (book: Address, a: PlaceArgs): Call => ({
  to: book,
  data: encodeFunctionData({ abi: orderBookAbi, functionName: 'place', args: [a.base, a.quote, sideNum(a.side), a.price, a.amount, BigInt(a.maxLevels), a.hint, a.rest] }),
})
export const cancelCall = (book: Address, id: bigint): Call =>
  ({ to: book, data: encodeFunctionData({ abi: orderBookAbi, functionName: 'cancel', args: [id] }) })

/** The parts of Settlement.sol's ABI the package uses (tested against the compiled artifact). */
export const settlementAbi = parseAbi([
  'struct Order { address maker; address base; address quote; uint8 side; uint256 price; uint256 amount; uint256 nonce; uint256 expiry; }',
  'function settle(Order[] makers, bytes[] sigs, uint256[] fills)',
  'function cancel(Order o)',
  'function filled(bytes32 hash) view returns (uint256)',
  'function cancelled(bytes32 hash) view returns (bool)',
  'event Trade(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint256 price, uint256 amount, uint256 quoteAmount)',
  'event OrderCancelled(bytes32 indexed orderHash)',
  'error BadSignature(uint256 i)',
  'error Expired(uint256 i)',
  'error Overfill(uint256 i, uint256 remaining)',
  'error OrderNotOpen(bytes32 hash)',
  'error NotMaker()',
  'error BadOrder()',
  'error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)',
  'error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)',
])

export const settleCall = (settlement: Address, makers: SignedOrder[], sigs: Hex[], fills: bigint[]): Call =>
  ({ to: settlement, data: encodeFunctionData({ abi: settlementAbi, functionName: 'settle', args: [makers, sigs, fills] }) })
export const settlementCancelCall = (settlement: Address, o: SignedOrder): Call =>
  ({ to: settlement, data: encodeFunctionData({ abi: settlementAbi, functionName: 'cancel', args: [o] }) })
