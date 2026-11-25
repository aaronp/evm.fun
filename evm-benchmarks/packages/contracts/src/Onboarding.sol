// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IAllows.sol";

/// Access codes for creating chains, deployed on root. Issuers (per `issuers`) commit keccak256(code);
/// anyone redeems a live code for a chainId, which records a grant the worker checks via isDeployAllowed.
contract Onboarding {
    struct Code { bytes32 hash; string label; address issuer; uint64 issuedAt; uint64 expiresAt; uint32 uses; uint32 usesLeft; bool revoked; }
    struct Grant { address by; string chainId; bytes32 codeHash; uint64 at; }

    IAllows public immutable issuers;
    Code[] private _codes;                            // slot 0
    mapping(bytes32 => uint256) private _codeIdx;     // slot 1: codeHash => 1-based index into _codes
    mapping(bytes32 => Grant[]) private _grants;      // slot 2: codeHash => its grants
    mapping(bytes32 => address) private _grantee;     // slot 3: keccak(chainId) => redeemer

    event Issued(bytes32 indexed codeHash, address indexed issuer, uint64 expiresAt, uint32 uses);
    event Revoked(bytes32 indexed codeHash);
    event Redeemed(bytes32 indexed codeHash, address indexed by, string chainId);

    constructor(IAllows issuers_) { issuers = issuers_; }

    modifier onlyIssuer() { require(issuers.allows(msg.sender, 0, address(0)), "issuers only"); _; }

    function issue(bytes32 codeHash, string calldata label, uint64 expiresAt, uint32 uses) external onlyIssuer {
        require(_codeIdx[codeHash] == 0, "code exists"); // revoked codes stay listed, so a hash is never reused
        require(uses >= 1 && uses <= 1000, "bad uses");
        require(expiresAt > block.timestamp, "bad expiry");
        _codes.push(Code(codeHash, label, msg.sender, uint64(block.timestamp), expiresAt, uses, uses, false));
        _codeIdx[codeHash] = _codes.length;
        emit Issued(codeHash, msg.sender, expiresAt, uses);
    }

    /// Stops further redeems; grants already recorded stay valid.
    function revoke(bytes32 codeHash) external onlyIssuer {
        uint256 i = _codeIdx[codeHash];
        require(i != 0, "no such code");
        _codes[i - 1].revoked = true;
        emit Revoked(codeHash);
    }

    /// Why redeem(code, chainId) would fail now; "" = it would succeed.
    function whyNot(string calldata code, string calldata chainId) public view returns (string memory) {
        if (!_validCode(bytes(code))) return "bad code";
        if (!_validUuid(bytes(chainId))) return "bad chain id";
        uint256 i = _codeIdx[keccak256(bytes(code))];
        if (i == 0) return "no such code";
        Code storage c = _codes[i - 1];
        if (c.revoked) return "code revoked";
        if (block.timestamp > c.expiresAt) return "code expired";
        if (c.usesLeft == 0) return "code used up";
        if (_grantee[keccak256(bytes(chainId))] != address(0)) return "chain id taken";
        return "";
    }

    function redeem(string calldata code, string calldata chainId) external {
        string memory why = whyNot(code, chainId);
        require(bytes(why).length == 0, why);
        bytes32 h = keccak256(bytes(code));
        _codes[_codeIdx[h] - 1].usesLeft--;
        _grantee[keccak256(bytes(chainId))] = msg.sender;
        _grants[h].push(Grant(msg.sender, chainId, h, uint64(block.timestamp)));
        emit Redeemed(h, msg.sender, chainId);
    }

    function isDeployAllowed(address signer, string calldata chainId) external view returns (bool) {
        return signer != address(0) && _grantee[keccak256(bytes(chainId))] == signer;
    }
    function codes() external view returns (Code[] memory) { return _codes; }
    function grants(bytes32 codeHash) external view returns (Grant[] memory) { return _grants[codeHash]; }

    /// 4-16 chars of A-Z 0-9 (apps upper-case and drop spaces/hyphens before sending)
    function _validCode(bytes memory b) private pure returns (bool) {
        if (b.length < 4 || b.length > 16) return false;
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            if (!((c >= "0" && c <= "9") || (c >= "A" && c <= "Z"))) return false;
        }
        return true;
    }
    /// lowercase UUID: 36 chars, hyphens at 8/13/18/23, else 0-9a-f
    function _validUuid(bytes memory b) private pure returns (bool) {
        if (b.length != 36) return false;
        for (uint256 i; i < 36; i++) {
            bytes1 c = b[i];
            if (i == 8 || i == 13 || i == 18 || i == 23) { if (c != "-") return false; }
            else if (!((c >= "0" && c <= "9") || (c >= "a" && c <= "f"))) return false;
        }
        return true;
    }
}
