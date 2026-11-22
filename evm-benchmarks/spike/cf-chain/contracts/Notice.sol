// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// A small self-describing contract for the views demo: its state is all behind zero-arg view functions.
contract Notice {
    address public author;
    string public title;
    uint64 public revision;
    string[] private _lines;

    event Posted(uint64 revision);

    constructor(string memory title_) { author = msg.sender; title = title_; }

    function lines() external view returns (string[] memory) { return _lines; }
    function post(string calldata title_, string[] calldata lines_) external {
        require(msg.sender == author, "author only");
        title = title_;
        delete _lines;
        for (uint256 i; i < lines_.length; i++) _lines.push(lines_[i]);
        revision++;
        emit Posted(revision);
    }
}
