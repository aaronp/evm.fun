// Verify worker: recovers the sender of each raw tx in a chunk and replies with the chunk's seq.
import {keccak256, recoverTransactionAddress, type Address, type Hex} from 'viem';

export interface VerifyRequest {
  seq: number;
  raws: Hex[];
}
export interface Verified {
  raw: Hex;
  hash: Hex;
  from: Address | null;
  error?: string;
}
export interface VerifyReply {
  seq: number;
  items: Verified[];
}

self.onmessage = async (e: MessageEvent<VerifyRequest>) => {
  const {seq, raws} = e.data;
  const items: Verified[] = [];
  for (const raw of raws) {
    const hash = keccak256(raw);
    try {
      // parses the tx (parseTransaction) and recovers the signer
      items.push({raw, hash, from: await recoverTransactionAddress({serializedTransaction: raw as any})});
    } catch (err) {
      items.push({raw, hash, from: null, error: err instanceof Error ? err.message : String(err)});
    }
  }
  self.postMessage({seq, items} satisfies VerifyReply);
};
