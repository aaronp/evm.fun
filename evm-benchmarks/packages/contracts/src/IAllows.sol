// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Does `caller` pass this rule? subject/owner are context for relative entities later; callers pass zero for now.
interface IAllows { function allows(address caller, bytes16 subject, address owner) external view returns (bool); }
