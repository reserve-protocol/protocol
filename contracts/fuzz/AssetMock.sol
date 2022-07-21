// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/interfaces/IAsset.sol";
import "contracts/plugins/assets/Asset.sol";
import "contracts/fuzz/Utils.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/fuzz/PriceModel.sol";

contract AssetMock is Asset {
    using FixLib for uint192;
    using PriceModelLib for PriceModel;

    event SetPrice(string symbol, uint192 price);
    PriceModel public model;

    constructor(
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        PriceModel memory model_
    )
        Asset(
            AggregatorV3Interface(address(1)), // stub out the expected chainlink oracle
            erc20_,
            IERC20Metadata(address(0)), // no reward token
            maxTradeVolume_,
            1 // stub out oracleTimeout
        )
    {
        model = model_;
        emit SetPrice(erc20.symbol(), model.price());
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (uint192) {
        return model.price();
    }

    function update(uint256 seed) public {
        model.update(uint192(seed));
        emit SetPrice(erc20.symbol(), model.price());
    }
}
