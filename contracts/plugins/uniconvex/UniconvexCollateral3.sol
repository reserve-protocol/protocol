// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "../assets/AbstractCollateral.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "hardhat/console.sol";
import "./ICurveCryptoPool.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/curve/ICurveRegistry.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/convex/IBaseRewardPool.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/convex/IRewards.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/convex/IBooster.sol";

// {
//     index: 9,
//     poolInfo: [
//       '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490',
//       '0x30D9410ED1D5DA1F6C8391af5338C93ab8d4035C',
//       '0xbFcF63294aD7105dEa65aA58F8AE5BE2D9d0952A',
//       '0x689440f2Ff927E1f24c72F1087E1FAF471eCe1c8',
//       '0x0000000000000000000000000000000000000000',
//       false,
//       lptoken: '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490',
//       token: '0x30D9410ED1D5DA1F6C8391af5338C93ab8d4035C',
//       gauge: '0xbFcF63294aD7105dEa65aA58F8AE5BE2D9d0952A',
//       crvRewards: '0x689440f2Ff927E1f24c72F1087E1FAF471eCe1c8',
//       stash: '0x0000000000000000000000000000000000000000',
//       shutdown: false
//     ]
//   }
// lptoken:  the underlying token(ex. the curve lp token)
// token: the convex deposit token(a 1:1 token representing an lp deposit).  The supply of this token can be used to calculate the TVL of the pool
// gauge: the curve "gauge" or staking contract used by the pool
// crvRewards: the main reward contract for the pool
// stash: a helper contract used to hold extra rewards (like snx) on behalf of the pool until distribution is called
// shutdown: a shutdown flag of the pool
//TODO use shutdown in REFRESH

contract UniconvexCollateral3 is Collateral {
    using OracleLib for AggregatorV3Interface;
    AggregatorV3Interface[N_COINS] public chainlinkFeeds;
    ICurveCryptoPool3Assets public immutable curvePool;

    //https://github.com/curvefi/curve-pool-registry/blob/0bdb116024ccacda39295bb3949c3e6dd0a8e2d9/contracts/Registry.vy#L114
    ICurveRegistry public immutable curveRegistry =
        ICurveRegistry(0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5);
    IBooster public immutable convexBooster = IBooster(0xF403C135812408BFbE8713b5A23a04b3D48AAE31);
    IBaseRewardPool baseRewardPool;
    function getConvexTokenFromPoolId(uint256 i) private view returns (address token) {
        IBooster.PoolInfo memory poolInfo =  convexBooster.poolInfo(i);
        return poolInfo.token;
    }
    constructor(
        uint256 poolId,
        uint192 fallbackPrice_,
        AggregatorV3Interface[N_COINS] memory chainlinkFeeds_,
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
        IBooster.PoolInfo memory poolInfo =  convexBooster.poolInfo(poolId);
        baseRewardPool = IBaseRewardPool(poolInfo.crvRewards);
        curvePool = ICurveCryptoPool3Assets(curveRegistry.get_pool_from_lp_token(poolInfo.lptoken));
        require(address(baseRewardPool) != address(0), "missing baseRewardPool");
        require(address(curvePool) != address(0), "missing curvePool");
        
        for (uint256 i = 1; i < N_COINS; i++) {
            require(address(chainlinkFeeds[i]) != address(0), "missing chainlink feed");
        }
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

// TODO: need to update openzeppelin. 4.8.0 has broken changes
// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/49c0e4370d0cc50ea6090709e3835a3091e33ee2/contracts/utils/math/Math.sol#L205
/**
     * @dev Return the log in base 2, rounded down, of a positive value.
     * Returns 0 if given 0.
     */
    function log2(uint256 value) internal pure returns (uint256) {
        uint256 result = 0;
        unchecked {
            if (value >> 128 > 0) {
                value >>= 128;
                result += 128;
            }
            if (value >> 64 > 0) {
                value >>= 64;
                result += 64;
            }
            if (value >> 32 > 0) {
                value >>= 32;
                result += 32;
            }
            if (value >> 16 > 0) {
                value >>= 16;
                result += 16;
            }
            if (value >> 8 > 0) {
                value >>= 8;
                result += 8;
            }
            if (value >> 4 > 0) {
                value >>= 4;
                result += 4;
            }
            if (value >> 2 > 0) {
                value >>= 2;
                result += 2;
            }
            if (value >> 1 > 0) {
                result += 1;
            }
        }
        return result;
    }


function nthRoot(uint256 x, uint256 divider) pure public returns(uint) {
    assert (x > 1);
    return 2 ** (log2 (x) / divider);
}

// https://github.com/curvefi/crypto_lp_pricing/blob/b6fea6943d5ddf8648f05d442daad284c1757c86/contracts/LPPrice_tricrypto_polygon.vy#L45
// def lp_price() -> uint256:
//     vp: uint256 = Tricrypto(POOL).virtual_price()
//     p1: uint256 = Tricrypto(POOL).price_oracle(0)
//     p2: uint256 = Tricrypto(POOL).price_oracle(1)

//     max_price: uint256 = 3 * vp * self.cubic_root(p1 * p2) / 10**18

//     # ((A/A0) * (gamma/gamma0)**2) ** (1/3)
//     g: uint256 = Tricrypto(POOL).gamma() * 10**18 / GAMMA0
//     a: uint256 = Tricrypto(POOL).A() * 10**18 / A0
//     discount: uint256 = max(g**2 / 10**18 * a, 10**34)  # handle qbrt nonconvergence
//     # if discount is small, we take an upper bound
//     discount = self.cubic_root(discount) * DISCOUNT0 / 10**18

//     max_price -= max_price * discount / 10**18

//     max_price = max_price * Stableswap(STABLE_POOL).get_virtual_price() / 10**18

//     return max_price

//TODO: double check
//TODO: floor root for 4 assets
//TODO: sqrt root for 2 assets
        //POOL: constant(address) = 0xD51a44d3FaE010294C616388b506AcdA1bfAAE46


    function strictPrice() external view returns (uint192) {

        //this values can be obtained from pool, but DISCOUNT0.
        uint256 GAMMA0 = 28000000000000;  // 2.8e-5
        uint256 A0  = 2 * 3**3 * 10000;
        uint256 DISCOUNT0 = 1087460000000000;  // 0.00108..
        // The current price of the pool LP token relative to the underlying pool assets.
        // Given as an integer with 1e18 precision.
        console.log("curvePoolAddress", address(curvePool));
        uint192 vp = uint192(curvePool.get_virtual_price());
        uint256 p1 = curvePool.price_oracle(0);   //or replace with trusted oracles?
        uint256 p2 = curvePool.price_oracle(1);

        uint256 max_price = 3 * vp * nthRoot(p1 * p2, 3) / 10**18;
        // ((A/A0) * (gamma/gamma0)**2) ** (1/3)
        uint256 g = curvePool.gamma() * 10**18 / GAMMA0;
        uint256 a = curvePool.A() * 10**18 / A0;
        uint256 discount = Math.max(g**2 / 10**18 * a, 10**34); // handle qbrt nonconvergence
        // if discount is small, we take an upper bound
        discount = nthRoot(discount, 3) * DISCOUNT0 / 10**18;
        
        max_price -= max_price * discount / 10**18;

        //TODO
        //max_price = max_price * Stableswap(STABLE_POOL).get_virtual_price() / 10**18;

        return uint192(max_price);
    }

    //explanation https://dev.gearbox.fi/docs/documentation/oracle/curve-pricefeed/
    function strictPriceOtherImplementation() external view returns (uint192) {
        // The current price of the pool LP token relative to the underlying pool assets.
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
