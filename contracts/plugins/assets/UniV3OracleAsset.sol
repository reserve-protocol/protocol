// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./Asset.sol";

interface IStaticOracle {
    function quoteAllAvailablePoolsWithTimePeriod(
        uint128 _baseAmount,
        address _baseToken,
        address _quoteToken,
        uint32 _period
    ) external view returns (uint256 _quoteAmount, address[] memory _queriedPools);
}

/**
 * @title UniV3OracleAsset
 * @notice Asset that uses a Uniswap V3 Oracle to get price.
 * Relies on the chainlink price of reference for conversion to UoA.
 * Oracle library used: https://github.com/Mean-Finance/uniswap-v3-oracle
 */
contract UniV3OracleAsset is Asset {
    using OracleLib for AggregatorV3Interface;

    IERC20Metadata immutable referenceToken;
    IStaticOracle public oracle = IStaticOracle(0xB210CE856631EeEB767eFa666EC7C1C57738d438);

    // solhint-disable no-empty-blocks
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        IERC20Metadata referenceToken_
    ) Asset(fallbackPrice_, chainlinkFeed_, erc20_, maxTradeVolume_, oracleTimeout_) {
        referenceToken = referenceToken_;
    }

    function strictPrice() public view override returns (uint192) {
        (uint256 price, ) = oracle.quoteAllAvailablePoolsWithTimePeriod(
            1e18,
            address(erc20),
            address(referenceToken),
            60
        );
        return
            (uint192(price) * chainlinkFeed.price(oracleTimeout)) /
            uint192(10**referenceToken.decimals());
    }
}
