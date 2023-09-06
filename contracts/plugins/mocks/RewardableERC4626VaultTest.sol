// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../assets/erc20/RewardableERC4626Vault.sol";
import "./ERC20MockRewarding.sol";

contract RewardableERC4626VaultTest is RewardableERC4626Vault {
    constructor(
        ERC20 _asset,
        string memory _name,
        string memory _symbol,
        ERC20 _rewardToken
    ) RewardableERC4626Vault(_asset, _name, _symbol, _rewardToken) {}

    function _claimAssetRewards() internal virtual override {
        ERC20MockRewarding(asset()).claim();
    }

    function sync() external {
        _claimAndSyncRewards();
    }
}
