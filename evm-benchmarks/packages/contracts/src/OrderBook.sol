// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// Escrowed limit order book. Price = quote raw units per one whole base unit (10^baseDecimals raw).
/// Fills are at the resting order's price; the taker pays rounded up and receives rounded down (resting order's favour),
/// so `quoteFor` here agrees to the unit with the TS package's `quoteFor` (packages/orderbook).
/// Per market and side the book is a doubly linked list of price levels, best first; each level is a FIFO of order ids.
/// Caveats: fee-on-transfer and rebasing tokens are unsupported (escrow is tracked in nominal amounts). Makers are paid
/// inside the matching loop, so a token that blacklists or hooks on transfer to a maker at the best level blocks
/// takers on that side until the maker cancels. The no-hint insert walk is unbounded: O(levels better than price).
/// A limit remainder never rests crossing the other side: if `maxLevels` stops matching first, place reverts
/// `BookTooThin(filled)`.
contract OrderBook is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Side { Buy, Sell }
    enum Status { None, Open, Filled, Cancelled }

    struct Order {
        address owner;
        address base;
        address quote;
        Side side;
        Status status;
        uint64 closedBlock;
        uint256 price;
        uint256 amount;
        uint256 filled;
    }

    struct Level {
        uint256 prev; // better price (0 = this is the best)
        uint256 next; // worse price (0 = last)
        uint256 size; // open base remaining at this price
        uint256 count; // open orders at this price; 0 = level not in the list
        uint256 head; // index of the first possibly-open id in `ids`
        uint256[] ids;
    }

    struct Book {
        uint256 best;
        mapping(uint256 => Level) levels;
    }

    uint256 public nextId = 1;
    mapping(uint256 => Order) private _orders;
    mapping(address => uint256[]) private _ordersOf;
    mapping(bytes32 => Book) private _books;
    /// Quote still escrowed by an open buy order (a fill pays sellers rounded down, so dust stays here until close).
    mapping(uint256 => uint256) private _quoteLeft;

    event OrderPlaced(uint256 indexed id, address indexed owner, address base, address quote, Side side, uint256 price, uint256 amount);
    event Trade(uint256 indexed makerId, uint256 indexed takerId, address maker, address taker, uint256 price, uint256 amount, uint256 quoteAmount);
    event OrderCancelled(uint256 indexed id);

    error OrderNotOpen(uint256 id, Status status);
    error NotOwner(uint256 id);
    error BadOrder();
    error BookTooThin(uint256 filled);

    // ---- views ----

    function orders(uint256 id) external view returns (Order memory) {
        return _orders[id];
    }

    function ordersOf(address owner) external view returns (uint256[] memory) {
        return _ordersOf[owner];
    }

    function best(address base, address quote, Side side) external view returns (uint256 price) {
        return _book(base, quote, side).best;
    }

    function level(address base, address quote, Side side, uint256 price)
        external
        view
        returns (uint256 prev, uint256 next, uint256 size, uint256 count)
    {
        Level storage l = _book(base, quote, side).levels[price];
        return (l.prev, l.next, l.size, l.count);
    }

    /// Open order ids at a price, FIFO. ponytail: skips cancelled ids still in the queue, O(queue length since head).
    function levelOrders(address base, address quote, Side side, uint256 price) external view returns (uint256[] memory out) {
        Level storage l = _book(base, quote, side).levels[price];
        out = new uint256[](l.count);
        uint256 k;
        for (uint256 i = l.head; k < out.length; i++) {
            if (_orders[l.ids[i]].status == Status.Open) out[k++] = l.ids[i];
        }
    }

    // ---- place / cancel ----

    /// Escrows the give side (see _take), matches the opposite side best price first and FIFO within a price, over at
    /// most `maxLevels` prices that cross `price`. Each fill is at the resting price: a taker buy pays quoteFor(fill, makerPrice, up), a taker sell gets quoteFor(fill, makerPrice, down).
    /// `rest`: the remainder rests at `price` (reverts `BookTooThin` if the other side still crosses it); otherwise (market) the order must fill completely or reverts
    /// `BookTooThin(filled)`. A taker buy only ever pays the makers' prices (improvement to the taker).
    /// `hint`: a price believed to be an existing level adjacent to `price` on its side. A correct hint makes the insert
    /// O(1); a wrong, unknown or zero hint falls back to walking from the best level, O(levels better than `price`)
    /// storage reads (~2.1k gas each cold).
    function place(address base, address quote, Side side, uint256 price, uint256 amount, uint256 maxLevels, uint256 hint, bool rest)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (price == 0 || amount == 0 || base == quote || base == address(0) || quote == address(0)) revert BadOrder();
        id = nextId++;
        _orders[id] = Order(msg.sender, base, quote, side, Status.Open, 0, price, amount, 0);
        _ordersOf[msg.sender].push(id);
        emit OrderPlaced(id, msg.sender, base, quote, side, price, amount);
        _take(id, maxLevels, hint, rest);
    }

    function _take(uint256 id, uint256 maxLevels, uint256 hint, bool rest) private {
        Order storage o = _orders[id];
        Side side = o.side;
        uint256 unit = 10 ** IERC20Metadata(o.base).decimals();

        // A sell escrows its base up front (makers are paid out of it while matching). A buy pays each maker straight
        // from the taker's wallet and escrows only its resting part: the same net result as escrowing at the limit and
        // refunding the rest, without the per-fill ceilings (which can sum a few raw units above one ceiling at the
        // limit) ever drawing on other orders' escrow.
        if (side == Side.Sell) IERC20(o.base).safeTransferFrom(msg.sender, address(this), o.amount);

        Fills memory c = Fills(id, unit, 0, 0);
        _match(o, c, maxLevels);
        uint256 left = o.amount - c.filled;
        // a remainder may only rest if nothing on the other side still crosses it (maxLevels can stop matching early)
        if (left > 0 && (!rest || _crosses(o))) revert BookTooThin(c.filled);
        o.filled = c.filled;

        uint256 keep; // quote escrowed for the resting part of a buy
        if (left == 0) {
            o.status = Status.Filled;
            o.closedBlock = uint64(block.number);
        } else {
            _insert(o, id, hint, left);
            if (side == Side.Buy) _quoteLeft[id] = keep = _ceil(left * o.price, unit);
        }

        // interactions (makers were paid in _fill right after their order's state was written)
        if (side == Side.Buy) {
            if (keep > 0) IERC20(o.quote).safeTransferFrom(msg.sender, address(this), keep);
            if (c.filled > 0) IERC20(o.base).safeTransfer(msg.sender, c.filled);
        } else if (c.quote > 0) {
            IERC20(o.quote).safeTransfer(msg.sender, c.quote);
        }
    }

    function cancel(uint256 id) external nonReentrant {
        Order storage o = _orders[id];
        if (o.status != Status.Open) revert OrderNotOpen(id, o.status);
        if (o.owner != msg.sender) revert NotOwner(id);
        o.status = Status.Cancelled;
        o.closedBlock = uint64(block.number);
        Book storage b = _book(o.base, o.quote, o.side);
        Level storage l = b.levels[o.price];
        uint256 left = o.amount - o.filled;
        l.size -= left;
        if (--l.count == 0) _unlink(b, o.price);
        emit OrderCancelled(id);
        if (o.side == Side.Sell) {
            IERC20(o.base).safeTransfer(msg.sender, left);
        } else {
            uint256 q = _quoteLeft[id];
            delete _quoteLeft[id];
            IERC20(o.quote).safeTransfer(msg.sender, q);
        }
    }

    // ---- internals ----

    /// Matching progress: base filled, and quote paid to makers (taker buy) or owed to the taker (taker sell).
    struct Fills {
        uint256 takerId;
        uint256 unit;
        uint256 filled;
        uint256 quote;
    }

    function _match(Order storage t, Fills memory c, uint256 maxLevels) private {
        Side opp = t.side == Side.Buy ? Side.Sell : Side.Buy;
        Book storage b = _book(t.base, t.quote, opp);
        uint256 p = b.best;
        // levels are visited best first, so stop at the first that doesn't cross the taker's limit
        for (; p != 0 && c.filled < t.amount && maxLevels > 0 && !_better(opp, t.price, p); maxLevels--) {
            Level storage l = b.levels[p];
            _matchLevel(t, c, l, p);
            uint256 next = l.next;
            if (l.count == 0) _unlink(b, p);
            p = next;
        }
    }

    /// FIFO through one level until the taker is filled or the level is empty.
    function _matchLevel(Order storage t, Fills memory c, Level storage l, uint256 p) private {
        uint256 h = l.head;
        uint256 before = c.filled;
        while (c.filled < t.amount && l.count > 0) {
            uint256 mid = l.ids[h];
            Order storage m = _orders[mid];
            if (m.status != Status.Open) { h++; continue; } // cancelled while queued
            uint256 f = m.amount - m.filled;
            if (f > t.amount - c.filled) f = t.amount - c.filled;
            c.filled += f;
            c.quote += _fill(c.takerId, t, mid, f, p, c.unit);
            if (m.status == Status.Filled) { l.count--; h++; }
        }
        l.head = h;
        l.size -= c.filled - before;
    }

    /// One fill of `f` base against maker `mid` at its price `p`: maker state first, then its payout.
    function _fill(uint256 takerId, Order storage t, uint256 mid, uint256 f, uint256 p, uint256 unit) private returns (uint256 q) {
        Order storage m = _orders[mid];
        m.filled += f;
        bool done = m.filled == m.amount;
        if (done) {
            m.status = Status.Filled;
            m.closedBlock = uint64(block.number);
        }
        if (t.side == Side.Buy) {
            q = _ceil(f * p, unit);
            emit Trade(mid, takerId, m.owner, msg.sender, p, f, q);
            IERC20(t.quote).safeTransferFrom(msg.sender, m.owner, q);
        } else {
            q = f * p / unit;
            uint256 rem = _quoteLeft[mid] - q;
            _quoteLeft[mid] = done ? 0 : rem;
            emit Trade(mid, takerId, m.owner, msg.sender, p, f, q);
            IERC20(t.base).safeTransfer(m.owner, f);
            if (done && rem > 0) IERC20(t.quote).safeTransfer(m.owner, rem); // rounding dust back to the maker
        }
    }

    function _insert(Order storage o, uint256 id, uint256 hint, uint256 size) private {
        (Side side, uint256 price) = (o.side, o.price);
        Book storage b = _book(o.base, o.quote, side);
        Level storage l = b.levels[price];
        l.ids.push(id);
        l.size += size;
        if (l.count++ > 0) return;
        // find neighbours (prev better than price, next worse); a hint that fits skips the walk
        uint256 prev;
        uint256 next = b.best;
        Level storage hl = b.levels[hint];
        if (hl.count > 0 && _better(side, hint, price) && (hl.next == 0 || _better(side, price, hl.next))) {
            (prev, next) = (hint, hl.next);
        } else if (hl.count > 0 && _better(side, price, hint) && (hl.prev == 0 || _better(side, hl.prev, price))) {
            (prev, next) = (hl.prev, hint);
        } else {
            while (next != 0 && _better(side, next, price)) (prev, next) = (next, b.levels[next].next);
        }
        (l.prev, l.next) = (prev, next);
        if (prev == 0) b.best = price;
        else b.levels[prev].next = price;
        if (next != 0) b.levels[next].prev = price;
    }

    /// Removes an empty level from the list. Its `ids`/`head` stay so a later order at this price queues behind them
    /// (all closed). ponytail: never cleared, levelOrders skips them; clear if refunds ever matter more than gas.
    function _unlink(Book storage b, uint256 price) private {
        Level storage l = b.levels[price];
        (uint256 prev, uint256 next) = (l.prev, l.next);
        if (prev == 0) b.best = next;
        else b.levels[prev].next = next;
        if (next != 0) b.levels[next].prev = prev;
        (l.prev, l.next) = (0, 0);
    }

    /// The opposite side's best level still crosses `o.price`.
    function _crosses(Order storage o) private view returns (bool) {
        Side opp = o.side == Side.Buy ? Side.Sell : Side.Buy;
        uint256 b = _book(o.base, o.quote, opp).best;
        return b != 0 && !_better(opp, o.price, b);
    }

    function _better(Side side, uint256 a, uint256 b) private pure returns (bool) {
        return side == Side.Buy ? a > b : a < b;
    }

    function _ceil(uint256 n, uint256 d) private pure returns (uint256) {
        return (n + d - 1) / d;
    }

    function _book(address base, address quote, Side side) private view returns (Book storage) {
        return _books[keccak256(abi.encode(base, quote, side))];
    }
}
