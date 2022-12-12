// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "contracts/interfaces/IAsset.sol";

abstract contract PermissionedMarket is Ownable, IMarket {
    mapping(address => bool) public approvedTargets;

    // solhint-disable-next-line no-empty-blocks
    constructor() Ownable() {}

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
