// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../libraries/Fixed.sol";
import "./FiatCollateral.sol";

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
contract ATokenFiatCollateral is FiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // solhint-disable no-empty-blocks

    constructor(CollateralConfig memory config) FiatCollateral(config) {
        prevReferencePrice = refPerTok();
    }

    // solhint-enable no-empty-blocks

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
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
