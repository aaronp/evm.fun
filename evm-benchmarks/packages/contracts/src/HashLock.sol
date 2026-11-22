// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// Hash time-locked transfer: the sender locks tokens under a hash; the recipient claims with the
/// preimage before `timeoutBlock`; the sender refunds from `timeoutBlock`. A lock with a non-empty
/// `wantChain` is an opening lock (its terms are the offer); one with an empty `wantChain` is an answer.
contract HashLock is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { None, Locked, Claimed, Refunded }

    struct Lock {
        address sender;
        address recipient;
        address token;
        uint256 amount;
        bytes32 hash;
        uint64 timeoutBlock;
        Status status;
        uint64 closedBlock; // set by claim() and refund()
        bytes32 secret; // set by claim()
        string wantChain;
        address wantLock;
        address wantToken;
        uint256 wantAmount;
    }

    uint256 public nextId = 1;
    mapping(uint256 => Lock) public locks;

    event Locked(uint256 indexed id, address indexed sender, address indexed recipient, bytes32 hash, address token, uint256 amount, uint64 timeoutBlock);
    event Claimed(uint256 indexed id, bytes32 secret);
    event Refunded(uint256 indexed id);

    error NotLocked(uint256 id, uint8 status);
    error NotRecipient();
    error NotSender();
    error BadSecret();
    error Expired(uint64 timeoutBlock);
    error NotExpired(uint64 timeoutBlock);
    error BadLock();

    function lock(
        address token,
        uint256 amount,
        address recipient,
        bytes32 hash,
        uint64 timeoutBlock,
        string calldata wantChain,
        address wantLock,
        address wantToken,
        uint256 wantAmount
    ) external nonReentrant returns (uint256 id) {
        if (amount == 0 || recipient == address(0) || timeoutBlock <= block.number) revert BadLock();
        if (bytes(wantChain).length != 0 && (wantToken == address(0) || wantLock == address(0))) revert BadLock();
        id = nextId++;
        locks[id] = Lock(
            msg.sender, recipient, token, amount, hash, timeoutBlock, Status.Locked, 0, bytes32(0),
            wantChain, wantLock, wantToken, wantAmount
        );
        emit Locked(id, msg.sender, recipient, hash, token, amount, timeoutBlock);
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }

    function claim(uint256 id, bytes32 secret) external nonReentrant {
        Lock storage l = locks[id];
        if (l.status != Status.Locked) revert NotLocked(id, uint8(l.status));
        if (l.recipient != msg.sender) revert NotRecipient();
        if (keccak256(abi.encodePacked(secret)) != l.hash) revert BadSecret();
        if (block.number >= l.timeoutBlock) revert Expired(l.timeoutBlock);
        l.status = Status.Claimed;
        l.secret = secret;
        l.closedBlock = uint64(block.number);
        emit Claimed(id, secret);
        IERC20(l.token).safeTransfer(l.recipient, l.amount);
    }

    function refund(uint256 id) external nonReentrant {
        Lock storage l = locks[id];
        if (l.status != Status.Locked) revert NotLocked(id, uint8(l.status));
        if (l.sender != msg.sender) revert NotSender();
        if (block.number < l.timeoutBlock) revert NotExpired(l.timeoutBlock);
        l.status = Status.Refunded;
        l.closedBlock = uint64(block.number);
        emit Refunded(id);
        IERC20(l.token).safeTransfer(l.sender, l.amount);
    }
}
