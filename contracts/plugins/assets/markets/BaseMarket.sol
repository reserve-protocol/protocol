// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "contracts/interfaces/IAsset.sol";

abstract contract BaseMarket is Ownable, Pausable, IMarket {
    IWETH public constant WETH = IWETH(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);

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

    function setOperationalState(bool enabled) external onlyOwner {
        if (enabled) {
            _unpause();
        } else {
            _pause();
        }
    }
}

interface IWETH {
    function deposit() external payable;

    function transfer(address to, uint256 value) external returns (bool);

    function withdraw(uint256) external;
}
