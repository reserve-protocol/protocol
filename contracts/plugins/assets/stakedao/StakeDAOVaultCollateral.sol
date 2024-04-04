// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../../../interfaces/IRToken.sol";
import "../../../libraries/Fixed.sol";
import "../curve/CurveStableCollateral.sol";
import "../OracleLib.sol";

interface IStakeDAOVault is IERC20Metadata {
    function token() external view returns (IERC20Metadata);

    function liquidityGauge() external view returns (IStakeDAOGauge);
}

interface IStakeDAOGauge {
    function claimer() external view returns (IStakeDAOClaimer);

    function reward_count() external view returns (uint256);

    function reward_tokens(uint256 index) external view returns (IERC20Metadata);
}

interface IStakeDAOClaimer {
    function claimRewards(address[] memory gauges) external;
}

/**
 * @title StakeDAOVaultCollateral
 * @notice Collateral plugin for a StakeDAO USDC+LP-f Vault that contains
 *   a Curve pool with a reference token and an RToken. The RToken can be
 *   of like kind of up-only in relation to the reference token.
 *
 * tok = sdUSDC+LP-f Vault
 * ref = USDC
 * tar = USD
 * UoA = USD
 */
contract StakeDAOVaultCollateral is CurveStableCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    IERC20Metadata[] public rewardTokens;

    IStakeDAOVault internal immutable vault; // the erc20 variable with useful typing
    IStakeDAOGauge internal immutable gauge;
    IStakeDAOClaimer internal immutable claimer;
    IERC20Metadata internal immutable usdcPlus;

    /// @param config.erc20 must be of type IStakeDAOVault
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig
    ) CurveStableCollateral(config, revenueHiding, ptConfig) {
        vault = IStakeDAOVault(address(config.erc20));
        lpToken = vault.token();
        gauge = vault.liquidityGauge();
        claimer = gauge.claimer();

        uint256 rewardCount = gauge.reward_count();
        for (uint256 i = 0; i < rewardCount; i++) {
            rewardTokens.push(gauge.reward_tokens(i));
        }
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} The actual price observed in the peg
    function tryPrice()
        external
        view
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 pegPrice
        )
    {
        // uint192 targetPerTok = targetPerTokChainlinkFeed.price(targetPerTokChainlinkTimeout);

        // // {UoA/tok} = {UoA/target} * {target/tok}
        // uint192 p = chainlinkFeed.price(oracleTimeout).mul(targetPerTok);
        // uint192 err = p.mul(oracleError, CEIL);

        high = p + err;
        low = p - err;
        // assert(low <= high); obviously true just by inspection

        // {target/ref} = {target/tok} / {ref/tok}
        pegPrice = targetPerTok.div(underlyingRefPerTok());
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view virtual override returns (uint192) {
        // {ref/tok} = quantity of the reference unit token in the pool per vault token
        // the vault is 1:1 with the LP token

        if (lpToken.totalSupply() == 0) return FIX_ONE;

        // {lpToken@t=0/lpToken}
        uint192 virtualPrice = _safeWrap(curvePool.get_virtual_price());
        // this is missing the fact that USDC+ has also appreciated in this time

        // {BU/rTok}
        uint192 rTokenRate = divuu(IRToken(token1).basketsNeeded(), IRToken(token1).totalSupply());
        // div-by-zero impossible

        // {ref/tok} = {ref/lpToken} = {lpToken@t=0/lpToken} * {1} * 2{ref/lpToken@t=0}
        return virtualPrice.mul(rTokenRate.sqrt()).mulu(2); // LP token worth $2
    }

    /// @custom:delegate-call
    function claimRewards() external override {
        uint256[] memory bals = new uint256[](rewardTokens.length);
        for (uint256 i = 0; i < rewardTokens.length; i++) {
            bals[i] = rewardTokens[i].balanceOf(address(this));
        }
        claimer.claimRewards();
        for (uint256 i = 0; i < rewardTokens.length; i++) {
            IERC20Metadata rewardToken = rewardTokens[i];
            emit RewardsClaimed(rewardToken, rewardToken.balanceOf(address(this)) - bals[i]);
        }
    }
}
