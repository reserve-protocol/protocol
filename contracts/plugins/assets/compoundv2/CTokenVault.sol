// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.17;

import "../vaults/RewardableERC20Vault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./ICToken.sol";

contract CTokenVault is RewardableERC20Vault {
    using SafeERC20 for ERC20;

    IComptroller public immutable comptroller;

    constructor(
        ERC20 _asset,
        string memory _name,
        string memory _symbol,
        IComptroller _comptroller,
        address compAddress
    ) RewardableERC20Vault(_asset, _name, _symbol, ERC20(compAddress)) {
        comptroller = _comptroller;
    }

    function _claimAssetRewards() internal virtual override {
        comptroller.claimComp(address(this));
    }

    function exchangeRateCurrent() external returns (uint256) {
        return ICToken(asset()).exchangeRateCurrent();
    }

    function exchangeRateStored() external view returns (uint256) {
        return ICToken(asset()).exchangeRateStored();
    }
}
