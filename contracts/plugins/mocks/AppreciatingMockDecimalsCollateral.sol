// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

// solhint-disable-next-line max-line-length
import { Asset, AppreciatingFiatCollateral, CollateralConfig, IRewardable } from "../assets/AppreciatingFiatCollateral.sol";
import { OracleLib } from "../assets/OracleLib.sol";
// solhint-disable-next-line max-line-length
import { AppreciatingMockDecimals } from "./AppreciatingMockDecimals.sol";
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { shiftl_toFix } from "../../libraries/Fixed.sol";

/**
 * AppreciatingMockDecimalsCollateral - Used for extreme tests on large decimals (e.g: 21, 27)
 */
contract AppreciatingMockDecimalsCollateral is AppreciatingFiatCollateral {
    int8 private immutable refDecimals;

    IERC20 private immutable rewardToken;

    /// config.erc20 must be an AppreciatingMockDecimals token
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {
        AppreciatingMockDecimals appToken = AppreciatingMockDecimals(address(config.erc20));
        refDecimals = int8(uint8(IERC20Metadata(appToken.underlying()).decimals()));
        require(refDecimals > 18, "only decimals > 18");
        rewardToken = IERC20(address(AppreciatingMockDecimals(address(erc20)).rewardToken()));
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view override returns (uint192) {
        return shiftl_toFix(AppreciatingMockDecimals(address(erc20)).rate(), -refDecimals);
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @custom:delegate-call
    function claimRewards() external virtual override(Asset, IRewardable) {
        uint256 _bal = rewardToken.balanceOf(address(this));
        IRewardable(address(erc20)).claimRewards();
        emit RewardsClaimed(rewardToken, rewardToken.balanceOf(address(this)) - _bal);
    }
}
