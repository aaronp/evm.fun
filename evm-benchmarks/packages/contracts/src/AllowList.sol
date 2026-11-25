// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IAllows.sol";

/// A list of entities that governs itself: any member may add or remove entities.
/// Only Key entities exist so far (value = the address); the last entity can't be removed, or the list would lock.
contract AllowList is IAllows {
    uint8 public constant KIND_KEY = 1;
    struct Entity { uint8 kind; bytes32 value; }
    Entity[] private _all;                     // slot 0
    mapping(bytes32 => uint256) private _idx;  // slot 1: keccak(kind, value) => 1-based index into _all

    constructor(Entity[] memory initial) {
        require(initial.length != 0, "no entities");
        for (uint256 i; i < initial.length; i++) _add(initial[i]);
    }

    modifier onlyMember() { require(allows(msg.sender, 0, address(0)), "not a member"); _; }

    function allows(address caller, bytes16, address) public view returns (bool) {
        return _idx[_key(KIND_KEY, bytes32(uint256(uint160(caller))))] != 0;
    }
    function entities() external view returns (Entity[] memory) { return _all; }

    function add(Entity calldata e) external onlyMember { _add(e); }
    function remove(Entity calldata e) external onlyMember {
        bytes32 k = _key(e.kind, e.value);
        uint256 i = _idx[k];
        if (i == 0) return;
        require(_all.length > 1, "last entity");
        Entity memory last = _all[_all.length - 1];
        _all[i - 1] = last; // swap-and-pop: order is not stable
        _idx[_key(last.kind, last.value)] = i;
        _all.pop();
        delete _idx[k];
    }

    function _add(Entity memory e) private {
        require(e.kind == KIND_KEY, "unknown kind");
        bytes32 k = _key(e.kind, e.value);
        require(_idx[k] == 0, "already present");
        _all.push(e);
        _idx[k] = _all.length;
    }
    function _key(uint8 kind, bytes32 value) private pure returns (bytes32) { return keccak256(abi.encode(kind, value)); }
}
