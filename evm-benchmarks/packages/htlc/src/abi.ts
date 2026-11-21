/** Embedded copy of HashLock.sol ABI (a test pins it to @evmb/contracts). */
export const hashLockAbi = [
  {
    "inputs": [],
    "name": "BadLock",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "BadSecret",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "timeoutBlock",
        "type": "uint64"
      }
    ],
    "name": "Expired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "timeoutBlock",
        "type": "uint64"
      }
    ],
    "name": "NotExpired",
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
        "internalType": "uint8",
        "name": "status",
        "type": "uint8"
      }
    ],
    "name": "NotLocked",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotRecipient",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotSender",
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
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "secret",
        "type": "bytes32"
      }
    ],
    "name": "Claimed",
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
        "name": "sender",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "hash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "timeoutBlock",
        "type": "uint64"
      }
    ],
    "name": "Locked",
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
      }
    ],
    "name": "Refunded",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "secret",
        "type": "bytes32"
      }
    ],
    "name": "claim",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "hash",
        "type": "bytes32"
      },
      {
        "internalType": "uint64",
        "name": "timeoutBlock",
        "type": "uint64"
      },
      {
        "internalType": "string",
        "name": "wantChain",
        "type": "string"
      },
      {
        "internalType": "address",
        "name": "wantLock",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "wantToken",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "wantAmount",
        "type": "uint256"
      }
    ],
    "name": "lock",
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
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "locks",
    "outputs": [
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "hash",
        "type": "bytes32"
      },
      {
        "internalType": "uint64",
        "name": "timeoutBlock",
        "type": "uint64"
      },
      {
        "internalType": "enum HashLock.Status",
        "name": "status",
        "type": "uint8"
      },
      {
        "internalType": "uint64",
        "name": "closedBlock",
        "type": "uint64"
      },
      {
        "internalType": "bytes32",
        "name": "secret",
        "type": "bytes32"
      },
      {
        "internalType": "string",
        "name": "wantChain",
        "type": "string"
      },
      {
        "internalType": "address",
        "name": "wantLock",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "wantToken",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "wantAmount",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
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
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "refund",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const
