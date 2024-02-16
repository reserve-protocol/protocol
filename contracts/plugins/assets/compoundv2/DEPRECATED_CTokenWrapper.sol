// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../erc20/RewardableERC20Wrapper.sol";
import "./ICToken.sol";

/// DEPRECATED
contract CTokenWrapper is RewardableERC20Wrapper {
    using SafeERC20 for ERC20;

    IComptroller public immutable comptroller;

    constructor(
        ERC20 _underlying,
        string memory _name,
        string memory _symbol,
        IComptroller _comptroller
    ) RewardableERC20Wrapper(_underlying, _name, _symbol, ERC20(_comptroller.getCompAddress())) {
        comptroller = _comptroller;
    }

    /// === Exchange rate pass-throughs ===

    // While these are included in the wrapper, it should probably not be used directly
    // by the collateral plugin for gas optimization reasons

    function exchangeRateCurrent() external returns (uint256) {
        return ICToken(address(underlying)).exchangeRateCurrent();
    }

    function exchangeRateStored() external view returns (uint256) {
        return ICToken(address(underlying)).exchangeRateStored();
    }

    // === Overrides ===

    function _claimAssetRewards() internal virtual override {
        address[] memory holders = new address[](1);
        address[] memory cTokens = new address[](1);
        holders[0] = address(this);
        cTokens[0] = address(underlying);
        comptroller.claimComp(holders, cTokens, false, true);
    }

    // No overrides of _deposit()/_withdraw() necessary: no staking required
}
