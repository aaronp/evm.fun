import { keccak256, toHex, type Hex } from 'viem'

/** 32 random bytes: the maker's secret. */
export const newSecret = (): Hex => toHex(crypto.getRandomValues(new Uint8Array(32)))
/** The lock's hash: keccak256 of the 32 bytes, as HashLock checks `keccak256(abi.encodePacked(secret))`. */
export const hashOf = (secret: Hex): Hex => keccak256(secret)
