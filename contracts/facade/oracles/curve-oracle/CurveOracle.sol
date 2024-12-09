// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { IExchangeRateOracle } from "../exchange-rate/IExchangeRateOracle.sol";

interface ICurveStableSwapNG {
    function coins(uint256 i) external view returns (address);

    function get_virtual_price() external view returns (uint256);

    function stored_rates() external view returns (uint256[] memory);
}

/**
 * @title CurveOracle
 * @notice An immutable Exchange Rate Oracle for a StableSwapNG Curve LP Token,
 *         with one or more appreciating assets. Only for 2-asset Curve LP Tokens.
 * @dev Does not account for native asset appreciation, only accounts for the
 *      appreciation in the Curve LP via trading volume.
 *
 *      The oracles specified for the pool MUST be for the base unit, for example
 *      if the paired token is sDAI, you'd specify the oracle for DAI/USD.
 */
contract CurveOracle {
    enum OracleType {
        STORED,
        STATIC,
        RTOKEN,
        CHAINLINK
    }

    struct OracleConfig {
        OracleType oracleType;
        address rateProvider;
        uint256 staticValue;
        uint256 timeout;
    }

    error BadOracleValue();
    error InvalidOracleType();

    ICurveStableSwapNG public immutable curvePool;
    OracleConfig public oracleConfig0;
    OracleConfig public oracleConfig1;

    constructor(
        address _curvePool,
        OracleConfig memory _oracleConfig0,
        OracleConfig memory _oracleConfig1
    ) {
        curvePool = ICurveStableSwapNG(_curvePool);
        oracleConfig0 = _oracleConfig0;
        oracleConfig1 = _oracleConfig1;
    }

    function _getTokenPrice(uint256 tokenId) internal view virtual returns (uint256) {
        OracleConfig memory oracleConfig = tokenId == 0 ? oracleConfig0 : oracleConfig1;
        OracleType oracleType = oracleConfig.oracleType;

        if (oracleType == OracleType.STORED) {
            return curvePool.stored_rates()[tokenId];
        } else if (oracleType == OracleType.STATIC) {
            return oracleConfig.staticValue;
        } else if (oracleType == OracleType.RTOKEN) {
            return IExchangeRateOracle(oracleConfig.rateProvider).exchangeRate();
        } else if (oracleType == OracleType.CHAINLINK) {
            AggregatorV3Interface oracle = AggregatorV3Interface(oracleConfig.rateProvider);
            uint8 decimals = oracle.decimals();
            (, int256 price, , uint256 updateTime, ) = oracle.latestRoundData();

            if (price < 0) {
                revert BadOracleValue();
            }

            if (block.timestamp - updateTime > (oracleConfig.timeout + 60)) {
                revert BadOracleValue();
            }

            if (decimals == 18) {
                return uint256(price);
            } else if (decimals < 18) {
                return uint256(price) * (10**(18 - decimals));
            } else {
                return uint256(price) / (10**(decimals - 18));
            }
        }

        revert InvalidOracleType();
    }

    function getPrice() public view virtual returns (uint256) {
        uint256 token0Price = _getTokenPrice(0);
        uint256 token1Price = _getTokenPrice(1);

        uint256 minPrice = token0Price < token1Price ? token0Price : token1Price;
        uint256 virtualPrice = curvePool.get_virtual_price();

        return (virtualPrice * minPrice) / 1e18;
    }
}
