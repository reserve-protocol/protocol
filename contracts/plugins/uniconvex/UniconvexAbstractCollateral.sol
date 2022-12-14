// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "@gearbox-protocol/integrations-v2/contracts/integrations/convex/IBaseRewardPool.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/convex/IRewards.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/convex/IBooster.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/curve/ICurvePool.sol";

import "./ICurveRegistry.sol";
import "../assets/AbstractCollateral.sol";

/**
    @title Convex Curve Abstract Collateral
    @notice Collateral plugin for Convex Curve pools
    @notice Yields CRV and CVX tokens,
    @notice as well as any extra rewards the Convex+Curve pool used as collateral reserve may have,
    @notice claimable with `claimRewards`.
    @notice Trading fees are accumulated in the Curve pool and result in `refPerTok` growth.
    @author Vic G. Larson
    @author Gene A. Tsvigun
  */
abstract contract UniconvexAbstractCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    uint256 public immutable poolId;
    //  Price feeds for Curve pool assets, their number is determined by the Curve pool used
    AggregatorV3Interface[] public chainlinkFeeds;
    uint192 public prevReferencePrice;
    // Curve pool used as collateral reserve
    ICurvePool public immutable curvePool;

    ICurveRegistry public immutable curveRegistry =
        ICurveRegistry(0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5);
    IBooster public immutable convexBooster = IBooster(0xF403C135812408BFbE8713b5A23a04b3D48AAE31);

    // Base reward pool, may contain multiple addresses of an extra reward pools
    IBaseRewardPool baseRewardPool;
    // Curve pool LP token - staked in a Convex pool
    address public immutable curveLPToken;

    /**
        @notice Constructor
        @param poolId_ Convex pool ID
        @param fallbackPrice_ Fallback price for the collateral asset
        @param chainlinkFeeds_ Price feeds for Curve pool assets
        @param maxTradeVolume_ Max RToken trade volume
        @param oracleTimeout_ Oracle timeout used for price feeds interaction
        @param targetName_ { target } Target name
        @param delayUntilDefault_ Delay until default
      */
    constructor(
        uint256 poolId_,
        uint192 fallbackPrice_,
        AggregatorV3Interface[] memory chainlinkFeeds_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint256 delayUntilDefault_
    )
        Collateral(
            fallbackPrice_,
            chainlinkFeeds_[0],
            IERC20Metadata(getConvexTokenFromPoolId(poolId_)),
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        poolId = poolId_;
        chainlinkFeeds = chainlinkFeeds_;
        IBooster.PoolInfo memory poolInfo = convexBooster.poolInfo(poolId);
        baseRewardPool = IBaseRewardPool(poolInfo.crvRewards);
        curveLPToken = poolInfo.lptoken;

        curvePool = ICurvePool(curveRegistry.get_pool_from_lp_token(curveLPToken));
        prevReferencePrice = refPerTok();
        require(
            address(baseRewardPool) != address(0),
            "UniconvexAbstractCollateral: missing baseRewardPool"
        );
        require(address(curvePool) != address(0), "UniconvexAbstractCollateral: missing curvePool");
        for (uint256 i = 1; i < chainlinkFeeds.length; i++) {
            require(
                address(chainlinkFeeds[i]) != address(0),
                "UniconvexAbstractCollateral: missing chainlink feed"
            );
        }

        // https://github.com/curvefi/curve-pool-registry/blob/0bdb116024ccacda39295bb3949c3e6dd0a8e2d9/contracts/Registry.vy#L344
        require(
            chainlinkFeeds.length == getPoolCoinsNumber(curvePool),
            "UniconvexAbstractCollateral: number of price feeds must equal to underlying coins"
        );
    }

    /**
        @notice Claim all reward tokens from the base reward pool and from all extra reward pools
      */
    function claimRewards() external override {
        (IERC20 token, uint256 amount) = getBaseRewards();
        if (amount > 0) {
            emit RewardsClaimed(token, amount);
        }

        for (uint256 i = 0; i < baseRewardPool.extraRewardsLength(); i++) {
            (IERC20 tokenExtra, uint256 amountExtra) = getExtraRewards(i);
            if (amountExtra > 0) {
                emit RewardsClaimed(tokenExtra, amountExtra);
            }
        }
    }

    /**
        @notice Calculates price of liquidity share by dividing Curve pool invariant by the amount of pool liquidity
        @notice https://github.com/curvefi/curve-contract/blob/master/integrations.md#bonus-measuring-profits
        @notice Stays unchanged on fee-less exchange, grows from exchange fees.
        @notice It is not affected by market fluctuations
        @return Price of liquidity share
      */
    function refPerTok() public view override returns (uint192) {
        return uint192(curvePool.get_virtual_price());
    }

    /// @return {UoA/tok} Total price in UoA of all assets obtainable by burning all liquidity in 1 whole token
    function strictPrice() external view returns (uint192) {
        return _calculatePrice();
    }

    /**
        @notice Convenience function for `curvePool.coins(i)`
        @param i Index of the coin
        @return address of the coin
      */
    function coins(uint256 i) external view returns (address) {
        return curvePool.coins(i);
    }

    /**
        @notice Convenience function for `curvePool.balances(i)`
        @param i Index of the coin
        @return balance of the coin
      */
    function balances(uint256 i) external view returns (uint256) {
        return curvePool.balances(i);
    }

    /**
        @notice Get rewards from the Convex base reward pool
        @notice Reward amount of a single token is sent to the collateral contract
        @return token reward token address
        @return amount transferred reward amount
      */
    function getBaseRewards() internal returns (IERC20 token, uint256 amount) {
        token = baseRewardPool.rewardToken();
        uint256 before = token.balanceOf(address(this));
        baseRewardPool.getReward(address(this), false);
        amount = token.balanceOf(address(this)) - before;
    }

    /**
        @notice Calculate the price of liquidity as a weighted sum of underlying asset prices divided by liquidity
        @notice The same amounts of assets would be obtained by burning one unit of liquidity
        @return Price of liquidity share
      */
    function _calculatePrice() internal view returns (uint192) {
        uint256 priceScaled;
        for (uint256 i = 0; i < chainlinkFeeds.length; i++) {
            priceScaled += _underlyingAssetPriceScaled(i);
        }
        return uint192(priceScaled / IERC20(curveLPToken).totalSupply());
    }

    /**
        @notice Calculate the price of one underlying asset in the pool using its corresponding Chainlink price feed
        @param i Index of the coin
        @return price of the coin scaled to Curve LP token decimals
      */
    function _underlyingAssetPriceScaled(uint256 i) internal view returns (uint256) {
        uint192 oraclePrice = chainlinkFeeds[i].price(oracleTimeout);
        uint256 decimals = IERC20Metadata(curveLPToken).decimals();
        uint256 coinDecimals = IERC20Metadata(curvePool.coins(i)).decimals();
        uint256 coinBalance = curvePool.balances(i);
        return (10 ** decimals * oraclePrice * coinBalance) / 10 ** coinDecimals;
    }

    /**
        @notice Get rewards from the i-th Convex extra reward pool
        @notice Reward amount of a single token is sent to the collateral contract
        @return token reward token address
        @return amount transferred reward amount
      */
    function getExtraRewards(uint256 i) internal returns (IERC20 token, uint256 amount) {
        IRewards rewardPool = IRewards(baseRewardPool.extraRewards(i));
        token = IERC20(rewardPool.rewardToken());
        uint256 before = token.balanceOf(address(this));
        rewardPool.getReward(address(this));
        amount = token.balanceOf(address(this)) - before;
    }

    /**
        @notice Get the number of underlying coins in the Curve pool
        @return Number of coins
      */
    function getPoolCoinsNumber(ICurvePool pool) internal view returns (uint256) {
        // https://github.com/curvefi/curve-pool-registry/blob/0bdb116024ccacda39295bb3949c3e6dd0a8e2d9/contracts/Registry.vy#L344
        return curveRegistry.get_n_coins(address(pool))[0];
    }

    /**
        @notice Get Convex pool address by index
        @param i Index of the pool
        @return token Convex pool address
      */
    function getConvexTokenFromPoolId(uint256 i) internal view returns (address token) {
        IBooster.PoolInfo memory poolInfo = convexBooster.poolInfo(i);
        return poolInfo.token;
    }
}
