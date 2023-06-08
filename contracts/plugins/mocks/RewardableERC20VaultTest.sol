// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../assets/vaults/RewardableERC20Vault.sol";
import "./ERC20MockRewarding.sol";

contract RewardableERC20VaultTest is RewardableERC20Vault {
    constructor(
        ERC20 _asset,
        string memory _name,
        string memory _symbol,
        ERC20 _rewardToken
    ) RewardableERC20Vault(_asset, _name, _symbol, _rewardToken) {}

    function _claimAssetRewards() internal virtual override {
        ERC20MockRewarding(asset()).claim();
    }
}
