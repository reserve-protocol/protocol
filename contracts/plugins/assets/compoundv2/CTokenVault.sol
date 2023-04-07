// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.17;

import "../vaults/RewardableERC20Vault.sol";
import "../../../vendor/solmate/ERC20Solmate.sol";
import "./ICToken.sol";

contract CTokenVault is RewardableERC20Vault {
    using SafeTransferLib for ERC20Solmate;

    IComptroller public immutable comptroller;

    constructor(
        ERC20Solmate _asset,
        string memory _name,
        string memory _symbol,
        ERC20Solmate _rewardToken,
        IComptroller _comptroller
    ) RewardableERC20Vault(_asset, _name, _symbol, _rewardToken) {
        comptroller = _comptroller;
    }

    function _claimAssetRewards() internal virtual override {
        comptroller.claimComp(address(this));
    }

    function exchangeRateCurrent() external returns (uint256) {
        return ICToken(address(asset)).exchangeRateCurrent();
    }

    function exchangeRateStored() external view returns (uint256) {
        return ICToken(address(asset)).exchangeRateStored();
    }
}
