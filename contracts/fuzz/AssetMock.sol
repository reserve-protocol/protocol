// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "contracts/interfaces/IAsset.sol";
import "contracts/plugins/assets/Asset.sol";
import "contracts/fuzz/Utils.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/fuzz/PriceModel.sol";
import "contracts/fuzz/OracleErrorMock.sol";

contract AssetMock is OracleErrorMock, Asset {
    using FixLib for uint192;
    using PriceModelLib for PriceModel;

    event SetPrice(string symbol, uint192 price);
    PriceModel public model;

    constructor(
        IERC20Metadata erc20_,
        TradingRange memory tradingRange_,
        PriceModel memory model_
    )
        Asset(
            AggregatorV3Interface(address(1)), // stub out the expected chainlink oracle
            erc20_,
            IERC20Metadata(address(0)), // no reward token
            tradingRange_,
            1 // stub out oracleTimeout
        )
    {
        model = model_;
        emit SetPrice(erc20.symbol(), model.price());
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price(AggregatorV3Interface, uint32) internal view virtual override returns (uint192) {
        maybeFail();
        return model.price();
    }

    function update(uint256 seed) public {
        model.update(uint192(seed));
        emit SetPrice(erc20.symbol(), model.price());
    }
}
