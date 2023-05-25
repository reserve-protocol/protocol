// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../AppreciatingFiatCollateral.sol";
import "../../../libraries/Fixed.sol";
import "../OracleLib.sol";

// This interface is redundant with the one from contracts/plugins/benddao/IStaticBToken,
// but it's compiled with a different solidity version.
interface IStaticBToken is IERC20Metadata {
    /**
     * @notice Claim rewards
     * @param forceUpdate Flag to retrieve latest rewards from `INCENTIVES_CONTROLLER`
     */
    function claimRewardsToSelf(bool forceUpdate) external;

    /**
     * @notice Returns the BendDAO liquidity index of the underlying bToken, denominated rate here
     * as it can be considered as an ever-increasing exchange rate
     * @return The liquidity index
     **/
    function rate() external view returns (uint256);

    /// @return The reward token, ie BEND
    // solhint-disable-next-line func-name-mixedcase
    function REWARD_TOKEN() external view returns (IERC20);
}

/**
 * @title BendWethCollateral
 * @notice Collateral plugin for BendDAO supplied ETH
 * tok = sBendWETH (Static Bend interest bearing WETH)
 * ref = WETH
 * tar = ETH
 * UoA = USD
 */
contract BendWethCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // solhint-disable no-empty-blocks
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {}

    // solhint-enable no-empty-blocks

    /// Can revert, used by other contract functions in order to catch errors
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} FIX_ONE
    function tryPrice()
        external
        view
        virtual
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 pegPrice
        )
    {
        // FIX_ONE
        pegPrice = targetPerRef();

        // {UoA/target}
        uint192 p = chainlinkFeed.price(oracleTimeout);

        // {UoA/tok} = {UoA/target} * {ref/tok} * {target/ref} (1)
        uint192 pLow = p.mul(refPerTok());

        // {UoA/tok} = {UoA/target} * {ref/tok} * {target/ref} (1)
        uint192 pHigh = p.mul(_underlyingRefPerTok());

        low = pLow - pLow.mul(oracleError);
        high = pHigh + pHigh.mul(oracleError);
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        uint256 rateInRays = IStaticBToken(address(erc20)).rate(); // {ray ref/tok}
        return shiftl_toFix(rateInRays, -27);
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev Use delegatecall
    function claimRewards() external virtual override(Asset, IRewardable) {
        IERC20 bend = IStaticBToken(address(erc20)).REWARD_TOKEN();
        uint256 oldBal = bend.balanceOf(address(this));
        IStaticBToken(address(erc20)).claimRewardsToSelf(true);
        emit RewardsClaimed(bend, bend.balanceOf(address(this)) - oldBal);
    }
}
