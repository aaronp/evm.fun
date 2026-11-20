// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// Same-chain escrowed swap: a maker escrows `giveAmt`, a taker fills the whole offer atomically.
contract Swap is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { None, Open, Filled, Cancelled }

    struct Offer {
        address maker;
        address giveToken;
        uint256 giveAmt;
        address getToken;
        uint256 getAmt;
        Status status;
    }

    uint256 public nextId = 1;
    mapping(uint256 => Offer) public offers;

    event OfferMade(uint256 indexed id, address indexed maker, address giveToken, uint256 giveAmt, address getToken, uint256 getAmt);
    event OfferTaken(uint256 indexed id, address indexed taker);
    event OfferCancelled(uint256 indexed id);

    error OfferNotOpen(uint256 id, Status status);
    error NotMaker(uint256 id);
    error BadOffer();

    function makeOffer(address giveToken, uint256 giveAmt, address getToken, uint256 getAmt)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (giveAmt == 0 || getAmt == 0 || giveToken == getToken || giveToken == address(0) || getToken == address(0)) {
            revert BadOffer();
        }
        id = nextId++;
        offers[id] = Offer(msg.sender, giveToken, giveAmt, getToken, getAmt, Status.Open);
        emit OfferMade(id, msg.sender, giveToken, giveAmt, getToken, getAmt);
        IERC20(giveToken).safeTransferFrom(msg.sender, address(this), giveAmt);
    }

    function take(uint256 id) external nonReentrant {
        Offer storage o = offers[id];
        if (o.status != Status.Open) revert OfferNotOpen(id, o.status);
        o.status = Status.Filled;
        emit OfferTaken(id, msg.sender);
        IERC20(o.getToken).safeTransferFrom(msg.sender, o.maker, o.getAmt);
        IERC20(o.giveToken).safeTransfer(msg.sender, o.giveAmt);
    }

    function cancel(uint256 id) external nonReentrant {
        Offer storage o = offers[id];
        if (o.status != Status.Open) revert OfferNotOpen(id, o.status);
        if (o.maker != msg.sender) revert NotMaker(id);
        o.status = Status.Cancelled;
        emit OfferCancelled(id);
        IERC20(o.giveToken).safeTransfer(msg.sender, o.giveAmt);
    }
}
