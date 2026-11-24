// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAdmin { function admin() external view returns (address); }

/// View-alias registry, deployed normally with the chain's ChainAccess address.
/// name -> { contract, recipe id, recipe params, access contract (0 = the chain's ChainAccess) }.
/// Admin is whoever is admin of the chain's ChainAccess, so there is one admin key per chain.
contract Aliases {
    address public immutable access;
    struct Alias { string name; address target; string recipe; string params; address access; }
    Alias[] private _all;                       // slot 0
    mapping(bytes32 => uint256) private _idx;   // slot 1: keccak(name) => 1-based index

    constructor(address access_) { access = access_; }

    event Registered(string name, address indexed target, string recipe, address access);
    event Removed(string name);

    modifier onlyAdmin() { require(msg.sender == IAdmin(access).admin(), "admin only"); _; }

    /// friendly lowercase names: [a-z0-9-], 1..32 chars; "access-controls" is built in
    function validName(string memory n) public pure returns (bool) {
        bytes memory b = bytes(n);
        if (b.length == 0 || b.length > 32 || keccak256(b) == keccak256("access-controls")) return false;
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            if (!((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "-")) return false;
        }
        return true;
    }

    function register(string calldata name, address target, string calldata recipe, string calldata params, address access) external onlyAdmin {
        require(validName(name), "bad name");
        require(target.code.length != 0, "no contract");
        bytes32 k = keccak256(bytes(name));
        Alias memory a = Alias(name, target, recipe, params, access);
        if (_idx[k] == 0) { _all.push(a); _idx[k] = _all.length; } else _all[_idx[k] - 1] = a; // re-register = update
        emit Registered(name, target, recipe, access);
    }
    function remove(string calldata name) external onlyAdmin {
        bytes32 k = keccak256(bytes(name));
        uint256 i = _idx[k];
        require(i != 0, "no such alias");
        Alias storage last = _all[_all.length - 1];
        _idx[keccak256(bytes(last.name))] = i;
        _all[i - 1] = last;
        _all.pop();
        delete _idx[k];
        emit Removed(name);
    }
    function get(string calldata name) external view returns (Alias memory a) {
        uint256 i = _idx[keccak256(bytes(name))];
        if (i != 0) a = _all[i - 1];
    }
    function all() external view returns (Alias[] memory) { return _all; }
}
