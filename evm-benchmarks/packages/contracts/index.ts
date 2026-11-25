import type {Abi, Hex} from 'viem'
import MintableTokenJson from './artifacts/MintableToken.json'
import AtomicSwapJson from './artifacts/AtomicSwap.json'
import AssetTokenJson from './artifacts/AssetToken.json'
import SwapJson from './artifacts/Swap.json'
import OrderBookJson from './artifacts/OrderBook.json'
import SettlementJson from './artifacts/Settlement.json'
import PoolJson from './artifacts/Pool.json'
import HashLockJson from './artifacts/HashLock.json'
import ChainAccessJson from './artifacts/ChainAccess.json'
import AliasesJson from './artifacts/Aliases.json'
import AllowListJson from './artifacts/AllowList.json'
import OnboardingJson from './artifacts/Onboarding.json'

export type Contract = {abi: Abi; bytecode: Hex}
export const MintableToken = MintableTokenJson as Contract
export const AtomicSwap = AtomicSwapJson as Contract
export const AssetToken = AssetTokenJson as Contract
export const Swap = SwapJson as Contract
export const OrderBook = OrderBookJson as Contract
export const Settlement = SettlementJson as Contract
export const Pool = PoolJson as Contract
export const HashLock = HashLockJson as Contract
export const ChainAccess = ChainAccessJson as Contract
export const Aliases = AliasesJson as Contract
export const AllowList = AllowListJson as Contract
export const Onboarding = OnboardingJson as Contract
