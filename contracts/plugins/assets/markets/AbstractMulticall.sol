// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";

abstract contract AbstractMulticall is Ownable {
    mapping(address => bool) public approvedTargets;

    function setApprovedTargets(address[] memory targets, bool[] memory approved)
        external
        onlyOwner
    {
        require(targets.length == approved.length, "BaseMarket: MISMATCHED_ARRAY_LENGTHS");
        for (uint256 i = 0; i < targets.length; i++) {
            approvedTargets[targets[i]] = approved[i];
        }
    }
}
