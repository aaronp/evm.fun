import mintable from '../../../contracts/src/MintableToken.sol?raw'
import atomicSwap from '../../../contracts/src/AtomicSwap.sol?raw'

const fixedSupply = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract FixedSupplyToken is ERC20 {
    constructor(string memory name_, string memory symbol_, uint256 supply) ERC20(name_, symbol_) {
        _mint(msg.sender, supply);
    }
}
`

export const templates: { name: string; source: string }[] = [
  { name: 'MintableToken.sol', source: mintable },
  { name: 'FixedSupplyToken.sol', source: fixedSupply },
  { name: 'AtomicSwap.sol', source: atomicSwap },
]
