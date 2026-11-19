import {keccak256, toHex} from 'viem';
import {privateKeyToAccount, type PrivateKeyAccount} from 'viem/accounts';

export function deriveAccounts(seed: string, count: number): PrivateKeyAccount[] {
  return Array.from({length: count}, (_, i) => privateKeyToAccount(keccak256(toHex(`${seed}:${i}`))));
}
