// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "contracts/interfaces/IAsset.sol";

abstract contract ChainlinkOracleMixin {
    AggregatorV3Interface internal priceFeed;

    constructor(address priceFeed_) {
        priceFeed = AggregatorV3Interface(priceFeed_);
    }

    function consultOracle() public view returns (uint192) {

        (
            uint80 roundId,
            int256 price, /*uint startedAt*/
            ,
            uint256 updateTime,
            uint80 answeredInRound
        ) = priceFeed.latestRoundData();

        // TODO: Should we use requires or reverts?
        require(updateTime != 0, "Incomplete round");
        require(answeredInRound >= roundId, "Stale price");

        // TODO: Merge with PriceOutsideRange?
        if (price == 0) {
            revert PriceIsZero();
        }

        // Scale price to 18 decimals
        uint256 scaledPrice = uint256(scalePrice(price, priceFeed.decimals(), 18));
        
        if (scaledPrice > type(uint192).max) {
            revert PriceOutsideRange();
        }

        return uint192(scaledPrice);
    }

    function scalePrice(
        int256 _price,
        uint8 _priceDecimals,
        uint8 _decimals
    ) internal pure returns (int256) {
        if (_priceDecimals < _decimals) {
            return _price * int256(10**uint256(_decimals - _priceDecimals));
        } else if (_priceDecimals > _decimals) {
            return _price / int256(10**uint256(_priceDecimals - _decimals));
        }
        return _price;
    }
}
