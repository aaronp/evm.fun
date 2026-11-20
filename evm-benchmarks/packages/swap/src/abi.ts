import type { Abi, Address } from 'viem'

export const swapAbi = [
  {
    "inputs": [],
    "name": "BadOffer",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "NotMaker",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "internalType": "enum Swap.Status",
        "name": "status",
        "type": "uint8"
      }
    ],
    "name": "OfferNotOpen",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ReentrancyGuardReentrantCall",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "SafeERC20FailedOperation",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "OfferCancelled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "maker",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "giveToken",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "giveAmt",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "getToken",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "getAmt",
        "type": "uint256"
      }
    ],
    "name": "OfferMade",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "taker",
        "type": "address"
      }
    ],
    "name": "OfferTaken",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "cancel",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "giveToken",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "giveAmt",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "getToken",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "getAmt",
        "type": "uint256"
      }
    ],
    "name": "makeOffer",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "nextId",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "offers",
    "outputs": [
      {
        "internalType": "address",
        "name": "maker",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "giveToken",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "giveAmt",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "getToken",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "getAmt",
        "type": "uint256"
      },
      {
        "internalType": "enum Swap.Status",
        "name": "status",
        "type": "uint8"
      },
      {
        "internalType": "address",
        "name": "taker",
        "type": "address"
      },
      {
        "internalType": "uint64",
        "name": "closedBlock",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "take",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const

const SWAP_FNS = ['makeOffer', 'take', 'cancel', 'nextId', 'offers']
/** Has Swap's functions, and `offers(id)` returns this Swap's 8-field layout (an older/foreign Swap is not picked). */
export const isSwapAbi = (abi: Abi): boolean => {
  const fns = abi.filter(e => e.type === 'function')
  return SWAP_FNS.every(f => fns.some(e => e.name === f)) && fns.find(e => e.name === 'offers')?.outputs.length === 8
}

/** The chain's Swap: the last record named `Swap` whose ABI is a Swap ABI. */
export const findSwap = (records: { name: string; address: Address; abi: Abi }[]): Address | undefined =>
  records.filter(r => r.name === 'Swap' && isSwapAbi(r.abi)).at(-1)?.address
