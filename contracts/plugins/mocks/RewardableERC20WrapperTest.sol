// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../assets/erc20/RewardableERC20Wrapper.sol";
import "./ERC20MockRewarding.sol";

contract RewardableERC20WrapperTest is RewardableERC20Wrapper {
    constructor(
        ERC20 _asset,
        string memory _name,
        string memory _symbol,
        ERC20 _rewardToken
    ) RewardableERC20Wrapper(_asset, _name, _symbol, _rewardToken) {}

    function _claimAssetRewards() internal virtual override {
        ERC20MockRewarding(address(underlying)).claim();
    }

    function sync() external {
        _claimAndSyncRewards();
    }
}
