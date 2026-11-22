// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Per-chain access list, injected into genesis at a fixed address (no constructor runs:
/// the DO writes admin/readOpen/initial members straight into storage, see src/chain.ts).
/// The chain DO calls canRead/canWrite against its own head state on every request.
contract ChainAccess {
    address public admin;                       // slot 0 (offset 0)
    bool public readOpen;                       // slot 0 (offset 20)
    mapping(address => bool) public isReader;   // slot 1
    mapping(address => bool) public isWriter;   // slot 2
    mapping(bytes32 => uint64) public inviteExpiry; // slot 3: keccak256(code) => expiry (unix s)

    event ReadOpen(bool open);
    event Reader(address indexed who, bool allowed);
    event Writer(address indexed who, bool allowed);
    event Admin(address indexed admin);
    event Invite(bytes32 indexed codeHash, uint64 expiry);
    event Claimed(bytes32 indexed codeHash, address indexed who);

    modifier onlyAdmin() { require(msg.sender == admin, "admin only"); _; }

    function canRead(address a) external view returns (bool) { return readOpen || isReader[a] || isWriter[a] || a == admin; }
    function canWrite(address a) external view returns (bool) { return isWriter[a] || a == admin; }

    function setReadOpen(bool open) external onlyAdmin { readOpen = open; emit ReadOpen(open); }
    function addReader(address a) external onlyAdmin { isReader[a] = true; emit Reader(a, true); }
    function removeReader(address a) external onlyAdmin { isReader[a] = false; emit Reader(a, false); }
    function addWriter(address a) external onlyAdmin { isWriter[a] = true; emit Writer(a, true); }
    function removeWriter(address a) external onlyAdmin { isWriter[a] = false; emit Writer(a, false); }
    function setAdmin(address a) external onlyAdmin { admin = a; emit Admin(a); }

    /// Join code: admin commits keccak256(code) with a short TTL; a joiner reveals the code.
    function invite(bytes32 codeHash, uint64 ttl) external onlyAdmin {
        uint64 exp = uint64(block.timestamp) + ttl;
        inviteExpiry[codeHash] = exp;
        emit Invite(codeHash, exp);
    }
    function claim(string calldata code) external {
        bytes32 h = keccak256(bytes(code));
        uint64 exp = inviteExpiry[h];
        require(exp != 0 && block.timestamp <= exp, "bad or expired code");
        delete inviteExpiry[h]; // single use
        isWriter[msg.sender] = true;
        emit Writer(msg.sender, true);
        emit Claimed(h, msg.sender);
    }
}
