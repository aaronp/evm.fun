// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Per-chain access list; the constructor makes the deployer admin. The chain calls canRead/canWrite on every request.
/// Members are enumerable (readers()/writers()) so the contract can be served as a view.
contract ChainAccess {
    address public admin;                          // slot 0 (offset 0)
    bool public readOpen;                          // slot 0 (offset 20)
    address[] private _readers;                    // slot 1
    address[] private _writers;                    // slot 2
    mapping(address => uint256) private readerIdx; // slot 3: 1-based index into _readers, 0 = absent
    mapping(address => uint256) private writerIdx; // slot 4
    struct Invite { uint64 expiry; uint32 usesLeft; uint8 grants; }
    mapping(bytes32 => Invite) public invites;     // slot 5: keccak256(code) => invite
    address[] private _deployers;                  // slot 6: appended after invites, may submit contract creations
    mapping(address => uint256) private deployerIdx; // slot 7
    uint8 public constant GRANT_READER = 1;
    uint8 public constant GRANT_WRITER = 2;
    uint8 public constant GRANT_CREATE_CHAIN = 4; // deploy code: claim adds no role
    uint8 public constant GRANT_DEPLOY = 8;       // claim adds writer + deployer

    event ReadOpen(bool open);
    event Reader(address indexed who, bool allowed);
    event Writer(address indexed who, bool allowed);
    event Deployer(address indexed who, bool allowed);
    event Admin(address indexed admin);
    event Invited(bytes32 indexed codeHash, uint64 expiry, uint32 uses, uint8 grants);
    event Claimed(bytes32 indexed codeHash, address indexed who, uint32 usesLeft);

    constructor() { admin = msg.sender; }
    modifier onlyAdmin() { require(msg.sender == admin, "admin only"); _; }

    function isReader(address a) public view returns (bool) { return readerIdx[a] != 0; }
    function isWriter(address a) public view returns (bool) { return writerIdx[a] != 0; }
    function canRead(address a) external view returns (bool) { return readOpen || isReader(a) || isWriter(a) || a == admin; }
    function canWrite(address a) external view returns (bool) { return isWriter(a) || a == admin; }
    function isDeployer(address a) public view returns (bool) { return deployerIdx[a] != 0; }
    function canDeploy(address a) external view returns (bool) { return isDeployer(a) || a == admin; }
    function deployers() external view returns (address[] memory) { return _deployers; }
    function readers() external view returns (address[] memory) { return _readers; }
    function writers() external view returns (address[] memory) { return _writers; }

    function setReadOpen(bool open) external onlyAdmin { readOpen = open; emit ReadOpen(open); }
    function addReader(address a) external onlyAdmin { _add(_readers, readerIdx, a); emit Reader(a, true); }
    function removeReader(address a) external onlyAdmin { _remove(_readers, readerIdx, a); emit Reader(a, false); }
    function addWriter(address a) external onlyAdmin { _add(_writers, writerIdx, a); emit Writer(a, true); }
    function removeWriter(address a) external onlyAdmin { _remove(_writers, writerIdx, a); emit Writer(a, false); }
    function addDeployer(address a) external onlyAdmin { _add(_deployers, deployerIdx, a); emit Deployer(a, true); }
    function removeDeployer(address a) external onlyAdmin { _remove(_deployers, deployerIdx, a); emit Deployer(a, false); }
    function setAdmin(address a) external onlyAdmin { admin = a; emit Admin(a); }

    function _add(address[] storage list, mapping(address => uint256) storage idx, address a) private {
        if (idx[a] != 0) return;
        list.push(a);
        idx[a] = list.length;
    }
    function _remove(address[] storage list, mapping(address => uint256) storage idx, address a) private {
        uint256 i = idx[a];
        if (i == 0) return;
        address last = list[list.length - 1];
        list[i - 1] = last; // swap-and-pop: order is not stable
        idx[last] = i;
        list.pop();
        delete idx[a];
    }

    /// Invite: admin commits keccak256(code). uses = 1 is single-use (the claim deletes it, a captured
    /// code is worthless afterwards); uses > 1 lets several keys join with one code until expiry or used up.
    /// grants is a bitmask of GRANT_READER | GRANT_WRITER | GRANT_CREATE_CHAIN | GRANT_DEPLOY on this contract.
    function invite(bytes32 codeHash, uint64 ttl, uint32 uses, uint8 grants) external onlyAdmin {
        require(uses > 0 && grants != 0 && grants <= 15, "bad invite");
        uint64 exp = uint64(block.timestamp) + ttl;
        invites[codeHash] = Invite(exp, uses, grants);
        emit Invited(codeHash, exp, uses, grants);
    }
    function revokeInvite(bytes32 codeHash) external onlyAdmin { delete invites[codeHash]; }
    function claim(string calldata code) external {
        bytes32 h = keccak256(bytes(code));
        Invite storage inv = invites[h];
        require(inv.usesLeft != 0 && block.timestamp <= inv.expiry, "bad, used up or expired code");
        uint8 g = inv.grants;
        uint32 left = inv.usesLeft - 1;
        if (left == 0) delete invites[h]; else inv.usesLeft = left;
        if (g & GRANT_READER != 0) { _add(_readers, readerIdx, msg.sender); emit Reader(msg.sender, true); }
        if (g & GRANT_DEPLOY != 0) { _add(_deployers, deployerIdx, msg.sender); emit Deployer(msg.sender, true); }
        if (g & (GRANT_WRITER | GRANT_DEPLOY) != 0) { _add(_writers, writerIdx, msg.sender); emit Writer(msg.sender, true); }
        emit Claimed(h, msg.sender, left);
    }
}
