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
export const isSwapAbi = (abi: Abi): boolean => {
  const n = new Set(abi.flatMap(e => (e.type === 'function' ? [e.name] : [])))
  return SWAP_FNS.every(f => n.has(f))
}

/** The chain's Swap: the last record named `Swap` whose ABI is a Swap ABI. */
export const findSwap = (records: { name: string; address: Address; abi: Abi }[]): Address | undefined =>
  records.filter(r => r.name === 'Swap' && isSwapAbi(r.abi)).at(-1)?.address
