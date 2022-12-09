// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "../assets/AbstractCollateral.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "hardhat/console.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/curve/ICurvePool_3.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/curve/ICurveRegistry.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/convex/IBaseRewardPool.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/convex/IRewards.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/convex/IBooster.sol";

contract UniconvexCollateral3 is Collateral {
    using OracleLib for AggregatorV3Interface;
    AggregatorV3Interface[N_COINS] public chainlinkFeeds;
    ICurvePool3Assets public immutable curvePool;
    ICurveRegistry public immutable curveRegistry =
        ICurveRegistry(0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5);
    IBooster public immutable convexBooster = IBooster(0xF403C135812408BFbE8713b5A23a04b3D48AAE31);
    IBaseRewardPool baseRewardPool;

    //TODO dont like curvePool not depends on erc20 token
    //https://github.com/curvefi/curve-pool-registry/blob/0bdb116024ccacda39295bb3949c3e6dd0a8e2d9/contracts/Registry.vy#L114
    constructor(
        //perhaps replace wiht poolId/poolInfo
        IBaseRewardPool baseRewardPool_,
        ICurvePool3Assets curvePool_,
        uint192 fallbackPrice_,
        AggregatorV3Interface[N_COINS] memory chainlinkFeeds_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint256 delayUntilDefault_
    )
        Collateral(
            fallbackPrice_,
            chainlinkFeeds_[0],
            IERC20Metadata(address(erc20_)),
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        for (uint256 i = 1; i < N_COINS; i++) {
            require(address(chainlinkFeeds_[i]) != address(0), "missing chainlink feed");
        }
        require(address(baseRewardPool_) != address(0), "missing baseRewardPool");
        baseRewardPool = baseRewardPool_;
        curvePool = curvePool_;
        //ICurvePool3Assets(curveRegistry.get_pool_from_lp_token(...));
        require(address(curvePool) != address(0), "missing curvePool");
        chainlinkFeeds = chainlinkFeeds_;
    }

    //TODO perhaps check in refresh()
    function refPerTok() public view override returns (uint192) {
        return uint192(curvePool.get_virtual_price());
    }

    // Can be used to define chainlink oracles order by caller
    function coins(uint256 i) external view returns (address) {
        return curvePool.coins(i);
    }

    function underlying_coins(uint256 i) external view returns (address) {
        return curvePool.underlying_coins(i);
    }

    function balances(uint256 i) external view returns (uint256) {
        return curvePool.balances(i);
    }

    function _calculatePrice(uint256 liquidity) internal view returns (uint192) {
        uint256 priceScaled;
        for (uint256 i = 0; i < N_COINS; i++) {
            uint192 price0 = chainlinkFeeds[i].price(oracleTimeout);
            console.log("balance", this.balances(i));
            console.log("coin", this.coins(i)); //underlying_coins not always implemented
            uint256 priceScaled0 = (price0 * this.balances(i)) /
                10 ** IERC20Metadata(this.coins(i)).decimals();
            console.log("priceScaled0", priceScaled0);
            priceScaled += priceScaled0;
        }
        return uint192(priceScaled / liquidity);
    }

    //explanation https://dev.gearbox.fi/docs/documentation/oracle/curve-pricefeed/
    function strictPrice() external view override returns (uint192) {
        //The current price of the pool LP token relative to the underlying pool assets.
        // Given as an integer with 1e18 precision.
        console.log("curvePoolAddress", address(curvePool));
        uint192 virtualPrice = uint192(curvePool.get_virtual_price());
        uint192 minPrice = type(uint192).max;
        for (uint256 i = 0; i < N_COINS; i++) {
            uint192 feedPrice = chainlinkFeeds[i].price(oracleTimeout);
            if (feedPrice < minPrice) {
                minPrice = feedPrice;
            }
        }
        console.log("virtualPrice", virtualPrice);
        console.log("minPrice", minPrice);
        //TODO what is collateral? i forget? mb totalSupply of this? or balance :)
        uint256 totalSupply = erc20.totalSupply();
        console.log("_calculatePrice", _calculatePrice(totalSupply));
        // feedPrice is fp 10e18
        return (minPrice * virtualPrice) / 10 ** 18;
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
