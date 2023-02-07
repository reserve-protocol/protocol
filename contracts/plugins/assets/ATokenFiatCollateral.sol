// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../libraries/Fixed.sol";
import "./AppreciatingFiatCollateral.sol";

// This interface is redundant with the one from contracts/plugins/aave/IStaticAToken,
// but it's compiled with a different solidity version.
interface IStaticAToken is IERC20Metadata {
    /**
     * @notice Claim rewards
     * @param forceUpdate Flag to retrieve latest rewards from `INCENTIVES_CONTROLLER`
     */
    function claimRewardsToSelf(bool forceUpdate) external;

    /**
     * @notice Returns the Aave liquidity index of the underlying aToken, denominated rate here
     * as it can be considered as an ever-increasing exchange rate
     * @return The liquidity index
     **/
    function rate() external view returns (uint256);

    /// @return The reward token, ie stkAAVE
    // solhint-disable-next-line func-name-mixedcase
    function REWARD_TOKEN() external view returns (IERC20);
}

/**
 * @title ATokenFiatCollateral
 * @notice Collateral plugin for an aToken for a UoA-pegged asset, like aUSDC or a aUSDP
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract ATokenFiatCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // solhint-disable no-empty-blocks

    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {}

    // solhint-enable no-empty-blocks

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        uint256 rateInRAYs = IStaticAToken(address(erc20)).rate(); // {ray ref/tok}
        return shiftl_toFix(rateInRAYs, -27);
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev Use delegatecall
    function claimRewards() external virtual {
        IERC20 stkAAVE = IStaticAToken(address(erc20)).REWARD_TOKEN();
        uint256 oldBal = stkAAVE.balanceOf(address(this));
        IStaticAToken(address(erc20)).claimRewardsToSelf(true);
        emit RewardsClaimed(stkAAVE, stkAAVE.balanceOf(address(this)) - oldBal);
    }
}
