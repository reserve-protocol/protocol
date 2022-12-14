// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "../assets/AbstractCollateral.sol";
import "./IUniswapV3Wrapper.sol";
import "contracts/libraries/Fixed.sol";

/**
    @title Uniswap V3 Collateral
    @notice {tok} UV3 LP token
    @notice {ref} UV3SQRT<A0><A1>, like UV3SQRTDAIUSDC
    @notice {target} USD
    @notice {UoA} USD
    @notice Abstract collateral plugin for Uniswap V3 positions.
    @notice Requires Uniswap V3 Wrapper to be deployed first to wrap the position used.
    @notice This contract is meant to be inherited by collateral implementations for fiat and non-fiat positions.
    @author Gene A. Tsvigun
    @author Vic G. Larson
  */
abstract contract UniswapV3Collateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    AggregatorV3Interface public immutable chainlinkFeedSecondAsset;
    uint8 public immutable underlyingERC20Decimals0;
    uint8 public immutable underlyingERC20Decimals1;

    uint192 public immutable fallbackPriceSecondAsset;

    constructor(
        uint192 fallbackPrice_,
        uint192 fallbackPriceSecondAsset_,
        AggregatorV3Interface chainlinkFeed_,
        AggregatorV3Interface chainlinkFeedSecondAsset_,
        IUniswapV3Wrapper uniswapV3Wrapper_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint256 delayUntilDefault_
    )
        Collateral(
            fallbackPrice_,
            chainlinkFeed_,
            IERC20Metadata(uniswapV3Wrapper_),
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(
            address(chainlinkFeedSecondAsset_) != address(0),
            "UniswapV3Collateral: missing Chainlink feed for second asset in pair"
        );
        require(
            address(uniswapV3Wrapper_) != address(0),
            "UniswapV3Collateral: uniswapV3Wrapper_ can't be 0"
        );
        fallbackPriceSecondAsset = fallbackPriceSecondAsset_;
        chainlinkFeedSecondAsset = chainlinkFeedSecondAsset_;
        address underlyingAsset0 = uniswapV3Wrapper_.token0();
        address underlyingAsset1 = uniswapV3Wrapper_.token1();
        underlyingERC20Decimals0 = IERC20Metadata(underlyingAsset0).decimals();
        underlyingERC20Decimals1 = IERC20Metadata(underlyingAsset1).decimals();
    }

    function claimRewards() external override {
        (address token0, address token1, uint256 amount0, uint256 amount1) = IUniswapV3Wrapper(
            address(erc20)
        ).claimRewards(msg.sender);
        if(amount0 > 0) {
            emit RewardsClaimed(IERC20(token0), amount0);
        }
        if(amount1 > 0) {
            emit RewardsClaimed(IERC20(token1), amount1);
        }
    }

    /// @return {UoA/tok} Total price in UoA of all assets obtainable by burning all liquidity in 1 whole token
    function strictPrice() external view override returns (uint192) {
        (uint256 amount0, uint256 amount1) = IUniswapV3Wrapper(address(erc20)).principal();
        //TODO use imaginary price for 0 liquidity, not fallback price , don't commit this TODO
        (uint192 price0, uint192 price1) = _priceFeeds();
        return
            _calculatePrice(
                underlyingERC20Decimals0,
                underlyingERC20Decimals1,
                amount0,
                amount1,
                price0,
                price1,
                IERC20(erc20).totalSupply()
            );
    }


    function _priceFeeds() internal view returns (uint192 price0, uint192 price1) {
        price0 = chainlinkFeed.price(oracleTimeout);
        price1 = chainlinkFeedSecondAsset.price(oracleTimeout);
    }

    function _fallbackPrice() public view returns (uint192) {
        (uint256 amount0, uint256 amount1, uint128 liquidity) = IUniswapV3Wrapper(address(erc20))
            .priceSimilarPosition();
        return
            _calculatePrice(
                underlyingERC20Decimals0,
                underlyingERC20Decimals1,
                amount0,
                amount1,
                fallbackPrice,
                fallbackPriceSecondAsset,
                liquidity
            );
    }

    function _calculatePrice(
        uint8 decimals0,
        uint8 decimals1,
        uint256 amount0,
        uint256 amount1,
        uint192 price0,
        uint192 price1,
        uint256 liquidity
    ) internal pure returns (uint192) {
        return uint192( ( FIX_ONE * price0 * amount0 / 10**decimals0 +
                          FIX_ONE * price1 * amount1 / 10**decimals1 ) / liquidity );
    }
}
