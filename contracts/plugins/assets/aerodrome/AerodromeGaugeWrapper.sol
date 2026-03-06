// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../erc20/RewardableERC20Wrapper.sol";
import "./vendor/IAeroGauge.sol";

// Note: Only supports AERO rewards.
contract AerodromeGaugeWrapper is RewardableERC20Wrapper {
    using SafeERC20 for IERC20;

    IAeroGauge public immutable gauge;

    /// @param _lpToken The Aerodrome LP token, transferrable
    constructor(
        ERC20 _lpToken,
        string memory _name,
        string memory _symbol,
        ERC20 _aero,
        IAeroGauge _gauge
    ) RewardableERC20Wrapper(_lpToken, _name, _symbol, _aero) {
        require(
            address(_aero) != address(0) &&
                address(_gauge) != address(0) &&
                address(_lpToken) != address(0),
            "invalid address"
        );

        require(address(_aero) == address(_gauge.rewardToken()), "wrong Aero");

        gauge = _gauge;
    }

    // deposit an Aerodrome LP token
    function _afterDeposit(uint256 _amount, address) internal override {
        underlying.approve(address(gauge), _amount);
        gauge.deposit(_amount);
    }

    // withdraw to Aerodrome LP token
    function _beforeWithdraw(uint256 _amount, address) internal override {
        gauge.withdraw(_amount);
    }

    // claim rewards - only supports AERO rewards
    function _claimAssetRewards() internal virtual override {
        gauge.getReward(address(this));
    }
}
