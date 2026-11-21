// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// Settles EIP-712 signed orders from an off-chain book. Makers sign orders (no gas) and keep custody; the taker
/// (msg.sender) sends one `settle` that checks every signature and moves both legs with `transferFrom`, so makers and
/// takers approve this contract. Price = quote raw units per one whole base unit (10^baseDecimals raw); each fill is at
/// the maker's price, rounded in the maker's favour per fill: a taker buying from a maker sell pays quoteFor(fill, up),
/// a taker selling to a maker buy receives quoteFor(fill, down) — the same as OrderBook.sol and the TS `quoteFor`.
/// The order id is its typed-data hash; `filled` and `cancelled` per hash are the on-chain truth.
/// Caveats: EOA signatures only (no ERC-1271). Fee-on-transfer and rebasing tokens are unsupported. `nonce` only makes
/// otherwise equal orders distinct; there is no per-maker nonce invalidation (cancel each order). Self-matches are
/// allowed. No reentrancy guard: every check and every `filled` write happen before the first transfer.
contract Settlement is EIP712 {
    using SafeERC20 for IERC20;

    /// side: 0 = Buy, 1 = Sell (OrderBook.Side) of the maker's base asset.
    struct Order {
        address maker;
        address base;
        address quote;
        uint8 side;
        uint256 price;
        uint256 amount;
        uint256 nonce;
        uint256 expiry; // unix seconds; expired when block.timestamp > expiry
    }

    bytes32 private constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,address base,address quote,uint8 side,uint256 price,uint256 amount,uint256 nonce,uint256 expiry)"
    );

    mapping(bytes32 => uint256) public filled;
    mapping(bytes32 => bool) public cancelled;

    event Trade(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint256 price, uint256 amount, uint256 quoteAmount);
    event OrderCancelled(bytes32 indexed orderHash);

    error BadSignature(uint256 i);
    error Expired(uint256 i);
    error Overfill(uint256 i, uint256 remaining);
    error OrderNotOpen(bytes32 hash);
    error NotMaker();
    error BadOrder();

    constructor() EIP712("EVMB Settlement", "1") {}

    function hashOrder(Order calldata o) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ORDER_TYPEHASH, o)));
    }

    /// Fills `fills[i]` of `makers[i]` (signed `sigs[i]`) against msg.sender. All makers share one market and side.
    /// Reverts BadOrder (lengths, empty, zero fill, mixed market/side, malformed order), BadSignature(i), Expired(i),
    /// OrderNotOpen(hash) for a cancelled order, Overfill(i, remaining); a short maker or taker reverts with the
    /// token's ERC-20 error and nothing moves.
    function settle(Order[] calldata makers, bytes[] calldata sigs, uint256[] calldata fills) external {
        uint256 n = makers.length;
        if (n == 0 || sigs.length != n || fills.length != n) revert BadOrder();
        Order calldata m0 = makers[0];
        if (m0.side > 1 || m0.base == m0.quote || m0.base == address(0) || m0.quote == address(0)) revert BadOrder();
        uint256 unit = 10 ** IERC20Metadata(m0.base).decimals();
        uint256[] memory quotes = new uint256[](n);

        // checks and effects for the whole batch
        for (uint256 i; i < n; i++) {
            Order calldata o = makers[i];
            uint256 f = fills[i];
            if (f == 0 || o.price == 0 || o.base != m0.base || o.quote != m0.quote || o.side != m0.side) revert BadOrder();
            bytes32 h = hashOrder(o);
            (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(h, sigs[i]);
            if (err != ECDSA.RecoverError.NoError || signer != o.maker) revert BadSignature(i);
            if (block.timestamp > o.expiry) revert Expired(i);
            if (cancelled[h]) revert OrderNotOpen(h);
            uint256 done = filled[h];
            if (done + f > o.amount) revert Overfill(i, o.amount - done);
            filled[h] = done + f;
            uint256 q = m0.side == 1 ? (f * o.price + unit - 1) / unit : (f * o.price) / unit;
            quotes[i] = q;
            emit Trade(h, o.maker, msg.sender, o.price, f, q);
        }

        // interactions
        IERC20 base = IERC20(m0.base);
        IERC20 quote = IERC20(m0.quote);
        for (uint256 i; i < n; i++) {
            address maker = makers[i].maker;
            if (m0.side == 1) {
                base.safeTransferFrom(maker, msg.sender, fills[i]);
                quote.safeTransferFrom(msg.sender, maker, quotes[i]);
            } else {
                base.safeTransferFrom(msg.sender, maker, fills[i]);
                quote.safeTransferFrom(maker, msg.sender, quotes[i]);
            }
        }
    }

    /// The maker marks an order cancelled on-chain. Reverts NotMaker, or OrderNotOpen if already cancelled or filled.
    function cancel(Order calldata o) external {
        if (msg.sender != o.maker) revert NotMaker();
        bytes32 h = hashOrder(o);
        if (cancelled[h] || filled[h] >= o.amount) revert OrderNotOpen(h);
        cancelled[h] = true;
        emit OrderCancelled(h);
    }
}
