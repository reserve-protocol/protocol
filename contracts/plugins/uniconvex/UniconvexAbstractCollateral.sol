// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "../assets/AbstractCollateral.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "hardhat/console.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/curve/ICurvePool.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/curve/ICurveRegistry.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/convex/IBaseRewardPool.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/convex/IRewards.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/convex/IBooster.sol";

abstract contract UniconvexAbstractCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface[] public chainlinkFeeds;
    uint192 public prevReferencePrice;
    ICurvePool public immutable curvePool;

    //https://github.com/curvefi/curve-pool-registry/blob/0bdb116024ccacda39295bb3949c3e6dd0a8e2d9/contracts/Registry.vy#L114
    ICurveRegistry public immutable curveRegistry =
        ICurveRegistry(0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5);
    IBooster public immutable convexBooster = IBooster(0xF403C135812408BFbE8713b5A23a04b3D48AAE31);
    IBaseRewardPool baseRewardPool;
    address public immutable curveToken;

    function getConvexTokenFromPoolId(uint256 i) private view returns (address token) {
        IBooster.PoolInfo memory poolInfo = convexBooster.poolInfo(i);
        return poolInfo.token;
    }

    constructor(
        uint256 poolId,
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
            IERC20Metadata(getConvexTokenFromPoolId(poolId)),
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        chainlinkFeeds = chainlinkFeeds_;
        IBooster.PoolInfo memory poolInfo = convexBooster.poolInfo(poolId);
        baseRewardPool = IBaseRewardPool(poolInfo.crvRewards);
        curveToken = poolInfo.lptoken;
        curvePool = ICurvePool(curveRegistry.get_pool_from_lp_token(poolInfo.lptoken));
        prevReferencePrice = refPerTok();
        require(address(baseRewardPool) != address(0), "missing baseRewardPool");
        require(address(curvePool) != address(0), "missing curvePool");
        for (uint256 i = 1; i < chainlinkFeeds.length; i++) {
            require(address(chainlinkFeeds[i]) != address(0), "missing chainlink feed");
        }
        //TODO implement
        require(chainlinkFeeds.length == 3, "implement feeds amount d equal to underlying coins");
    }

    function refPerTok() public view override returns (uint192) {
        return uint192(curvePool.get_virtual_price());
    }

    // Can be used to define chainlink oracles order by caller
    function coins(uint256 i) external view returns (address) {
        return curvePool.coins(i);
    }

    // can be not always Implements
    // perhaps better use registry to got underlying coins
    function underlying_coins(uint256 i) external view returns (address) {
        return curvePool.underlying_coins(i);
    }

    function balances(uint256 i) external view returns (uint256) {
        return curvePool.balances(i);
    }

    function _underlyingAssetPriceScaled(uint256 i) private view returns (uint256 underlyingAssetPriceScaled) {
        uint192 oraclePrice = chainlinkFeeds[i].price(oracleTimeout);
        console.log("oraclePrice", oraclePrice);
        uint256 decimals = IERC20Metadata(curveToken).decimals();
        console.log("decimals", decimals);
        underlyingAssetPriceScaled =
            (10 ** decimals * (oraclePrice * this.balances(i))) /
            10 ** IERC20Metadata(this.coins(i)).decimals();
        console.log("underlyingAssetPriceScaled_", underlyingAssetPriceScaled);
    }

    //TODO check power of fixed point (result)
    // we calc price of liquidity as sum price of underlying assets pro-rata divided by liquidity
    // the same amounts of assets would be obtained by burn of our liquidity
    // also allowed to implement price as min price for some circumferences https://dev.gearbox.fi/docs/documentation/oracle/curve-pricefeed/
    // seems as not correspond to reserve way
    function _calculatePrice() internal view returns (uint192) {
        uint256 priceScaled;
        for (uint256 i = 0; i < chainlinkFeeds.length; i++) {
            priceScaled += _underlyingAssetPriceScaled(i);
        }
        console.log("totalSupply", IERC20(curveToken).totalSupply());
        return uint192(priceScaled / IERC20(curveToken).totalSupply());
    }

    function strictPrice() external view returns (uint192) {
        return _calculatePrice();
    }

    function getBaseRewards() internal returns (IERC20 token, uint256 amount) {
        token = baseRewardPool.rewardToken();
        uint256 before = token.balanceOf(address(this));
        baseRewardPool.getReward(address(this), false);
        amount = token.balanceOf(address(this)) - before;
    }

    function getExtraRewards(uint256 i) internal returns (IERC20 token, uint256 amount) {
        IRewards rewardPool = IRewards(baseRewardPool.extraRewards(i));
        token = IERC20(rewardPool.rewardToken());
        uint256 before = token.balanceOf(address(this));
        rewardPool.getReward(address(this));
        amount = token.balanceOf(address(this)) - before;
    }

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
}
