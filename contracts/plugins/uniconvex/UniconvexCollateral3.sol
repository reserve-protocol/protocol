// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "../assets/AbstractCollateral.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "hardhat/console.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/curve/ICurvePool_3.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/curve/ICurveRegistry.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/convex/IBaseRewardPool.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/convex/IRewards.sol";
import "@gearbox-protocol/integrations-v2/contracts/integrations/convex/IBooster.sol";

//CRYPTO POOLS like USDT-BTC-WETH - strict order
//STABLE POOLS like DAI-USDC-USDT
//TODO REPORT_GAS FOR REFRESH
//TODO use shutdown in REFRESH
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

contract UniconvexCollateral3 is Collateral {
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface[N_COINS] public chainlinkFeeds;
    uint192 public prevReferencePrice;
    ICurvePool3Assets public immutable curvePool;

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
        IBooster.PoolInfo memory poolInfo = convexBooster.poolInfo(poolId);
        baseRewardPool = IBaseRewardPool(poolInfo.crvRewards);
        curveToken = poolInfo.lptoken;
        curvePool = ICurvePool3Assets(curveRegistry.get_pool_from_lp_token(poolInfo.lptoken));
        prevReferencePrice = refPerTok();
        require(address(baseRewardPool) != address(0), "missing baseRewardPool");
        require(address(curvePool) != address(0), "missing curvePool");
        for (uint256 i = 1; i < N_COINS; i++) {
            require(address(chainlinkFeeds[i]) != address(0), "missing chainlink feed");
        }
    }

    function priceNotInBounds(
        uint192 price,
        uint192 peg,
        uint192 delta
    ) internal pure returns (bool) {
        return price < peg - delta || price > peg + delta;
    }

    function poolIsAwayFromOptimalPoint() internal pure returns (bool) {
        return true;
    }

    // //Fiat
    function refresh() external override{
        if (alreadyDefaulted()) return;

        CollateralStatus oldStatus = status();

        uint192 referencePrice = refPerTok();
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } 
        else {
            for (uint256 i = 0; i < N_COINS; i++) {
                try chainlinkFeed.price_(oracleTimeout) returns (uint192 oraclePrice) {
                    uint192 peg = (pricePerTarget() * targetPerRef()) / FIX_ONE;
                    uint192 delta = 0; // (peg * defaultThreshold) / FIX_ONE;
                    if (priceNotInBounds(oraclePrice, peg, delta)) {
                        markStatus(CollateralStatus.IFFY);
                        break;
                    } else {
                        markStatus(CollateralStatus.SOUND);
                    }
                } catch (bytes memory errData) {
                    if (errData.length == 0) revert();
                    markStatus(CollateralStatus.IFFY);
                    break; //TODO check with broken feed
                }
            }
            if (poolIsAwayFromOptimalPoint()) {
                markStatus(CollateralStatus.IFFY);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }

    function refreshNonFiat() external /*override*/ {
        if (alreadyDefaulted()) return;

        CollateralStatus oldStatus = status();

        uint192 referencePrice = refPerTok();
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            //TODO need to check feeds
            try this.strictPrice() returns (uint192) {
                markStatus(CollateralStatus.SOUND);
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTargetNonFiat() public view /*override*/ returns (uint192) {
        return strictPrice();
    }

    //TODO perhaps check in refresh()
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

    //TODO check power of fixed point (result)
    // we calc price of liquidity as sum price of underlying assets pro-rata divided by liquidity
    // the same amounts of assets would be obtained by burn of our liquidity
    // also allowed to implement price as min price for some circumferences https://dev.gearbox.fi/docs/documentation/oracle/curve-pricefeed/
    // seems as not correspond to reserve way
    function _calculatePrice() internal view returns (uint192) {
        uint256 priceScaled;
        for (uint256 i = 0; i < N_COINS; i++) {
            uint192 oraclePrice = chainlinkFeeds[i].price(oracleTimeout);
            console.log("oraclePrice", oraclePrice);
            uint256 decimals = IERC20Metadata(curveToken).decimals();
            console.log("decimals", decimals);
            uint256 underlyingAssetPriceScaled = (10 ** decimals *
                (oraclePrice * this.balances(i))) / 10 ** IERC20Metadata(this.coins(i)).decimals();
            console.log("underlyingAssetPriceScaled_", underlyingAssetPriceScaled);
            priceScaled += underlyingAssetPriceScaled;
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
