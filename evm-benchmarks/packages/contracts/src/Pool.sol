// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// x · y = k liquidity pool for one unordered pair (Uniswap v2 shape, written from scratch). The pool is its own
/// 18-decimal LP token. Integer maths, mirrored to the unit by the TS package (packages/pool):
///  - swap: 30 bps fee on input, `out = amountIn·9970·Rout / (Rin·10000 + amountIn·9970)` (floor);
///  - first deposit: `shares = floor(√(baseIn·10^(18−db) · quoteIn·10^(18−dq))) − 1000`, the 1000 locked at 0x…dEaD
///    (LP shares are in whole-unit terms whatever the token decimals);
///  - later deposits: `shares = min(baseIn·S/Rb, quoteIn·S/Rq)` (floor); only `ceil(shares·R/S)` of each is pulled;
///  - remove: `shares·R/S` of each (floor).
/// Caveats: fee-on-transfer and rebasing tokens are unsupported (reserves are tracked in nominal amounts, not synced
/// from balances; tokens sent directly to the pool are stranded). No flash swaps, no price oracle.
contract Pool is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 private constant MINIMUM_LIQUIDITY = 1000;

    address public immutable base;
    address public immutable quote;
    uint256 private immutable _baseScale; // 10^(18 − base decimals)
    uint256 private immutable _quoteScale;

    uint256 private _rb;
    uint256 private _rq;

    event LiquidityAdded(address indexed provider, uint256 base, uint256 quote, uint256 shares);
    event LiquidityRemoved(address indexed provider, uint256 base, uint256 quote, uint256 shares);
    event Swapped(address indexed trader, address tokenIn, uint256 amountIn, uint256 amountOut, uint256 reserveBase, uint256 reserveQuote);

    error BadAmount();
    error BadToken();
    error Slippage(uint256 out, uint256 min);
    error NoLiquidity();

    constructor(address base_, address quote_) ERC20(_lpName(base_, quote_), "PLP") {
        base = base_;
        quote = quote_;
        _baseScale = _scale(base_);
        _quoteScale = _scale(quote_);
    }

    function reserves() external view returns (uint256, uint256) {
        return (_rb, _rq);
    }

    /// Deposit up to `baseIn`/`quoteIn`; mints `shares` (≥ `minShares`) and pulls only the proportional amounts.
    function addLiquidity(uint256 baseIn, uint256 quoteIn, uint256 minShares) external nonReentrant returns (uint256 shares) {
        uint256 s = totalSupply();
        uint256 rb = _rb;
        uint256 rq = _rq;
        if (s == 0) {
            uint256 root = Math.sqrt(baseIn * _baseScale * (quoteIn * _quoteScale));
            if (root <= MINIMUM_LIQUIDITY) revert BadAmount();
            shares = root - MINIMUM_LIQUIDITY;
            _mint(DEAD, MINIMUM_LIQUIDITY);
        } else {
            shares = Math.min(baseIn * s / rb, quoteIn * s / rq);
            if (shares == 0) revert BadAmount();
            baseIn = Math.ceilDiv(shares * rb, s);
            quoteIn = Math.ceilDiv(shares * rq, s);
        }
        if (shares < minShares) revert Slippage(shares, minShares);
        _rb = rb + baseIn;
        _rq = rq + quoteIn;
        _mint(msg.sender, shares);
        IERC20(base).safeTransferFrom(msg.sender, address(this), baseIn);
        IERC20(quote).safeTransferFrom(msg.sender, address(this), quoteIn);
        emit LiquidityAdded(msg.sender, baseIn, quoteIn, shares);
    }

    /// Burn `shares` for their floor share of each reserve.
    function removeLiquidity(uint256 shares, uint256 minBase, uint256 minQuote)
        external
        nonReentrant
        returns (uint256 baseOut, uint256 quoteOut)
    {
        uint256 s = totalSupply();
        if (s == 0) revert NoLiquidity();
        if (shares == 0) revert BadAmount();
        baseOut = shares * _rb / s;
        quoteOut = shares * _rq / s;
        if (baseOut < minBase) revert Slippage(baseOut, minBase);
        if (quoteOut < minQuote) revert Slippage(quoteOut, minQuote);
        _rb -= baseOut;
        _rq -= quoteOut;
        _burn(msg.sender, shares);
        IERC20(base).safeTransfer(msg.sender, baseOut);
        IERC20(quote).safeTransfer(msg.sender, quoteOut);
        emit LiquidityRemoved(msg.sender, baseOut, quoteOut, shares);
    }

    /// Sell `amountIn` of `tokenIn` (base or quote) for at least `minOut` of the other.
    function swap(address tokenIn, uint256 amountIn, uint256 minOut) external nonReentrant returns (uint256 amountOut) {
        bool baseIn = tokenIn == base;
        if (!baseIn && tokenIn != quote) revert BadToken();
        uint256 rb = _rb;
        uint256 rq = _rq;
        if (rb == 0 || rq == 0) revert NoLiquidity();
        (uint256 rIn, uint256 rOut) = baseIn ? (rb, rq) : (rq, rb);
        uint256 inWithFee = amountIn * 9970;
        amountOut = inWithFee * rOut / (rIn * 10000 + inWithFee);
        if (amountOut == 0) revert BadAmount();
        if (amountOut < minOut) revert Slippage(amountOut, minOut);
        (rb, rq) = baseIn ? (rb + amountIn, rq - amountOut) : (rb - amountOut, rq + amountIn);
        _rb = rb;
        _rq = rq;
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(baseIn ? quote : base).safeTransfer(msg.sender, amountOut);
        emit Swapped(msg.sender, tokenIn, amountIn, amountOut, rb, rq);
    }

    /// Validates the pair (runs before the constructor body, as the ERC20 name argument) and builds the LP name.
    function _lpName(address base_, address quote_) private view returns (string memory) {
        if (base_ == address(0) || quote_ == address(0) || base_ == quote_) revert BadToken();
        return string.concat("Pool LP ", IERC20Metadata(base_).symbol(), "/", IERC20Metadata(quote_).symbol());
    }

    function _scale(address token) private view returns (uint256) {
        uint8 d = IERC20Metadata(token).decimals();
        if (d > 18) revert BadToken();
        return 10 ** (18 - d);
    }
}
