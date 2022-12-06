// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "contracts/interfaces/IAsset.sol";
import "contracts/plugins/assets/Asset.sol";
import "contracts/fuzz/Utils.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/fuzz/OracleErrorMock.sol";
import "contracts/fuzz/PriceModel.sol";
import "contracts/fuzz/ERC20Fuzz.sol";

contract AssetMock is OracleErrorMock, Asset {
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
            model_.curr,
            AggregatorV3Interface(address(1)), // stub out the expected chainlink oracle
            erc20_,
            maxTradeVolume_,
            1 // stub out oracleTimeout
        )
    {
        model = model_;
        emit SetPrice(erc20.symbol(), model.price());
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price(AggregatorV3Interface, uint48) internal view virtual override returns (uint192) {
        maybeFail();
        return model.price();
    }

    function update(uint256 seed) public {
        model.update(uint192(seed));
        emit SetPrice(erc20.symbol(), model.price());
    }

    // ==== Rewards ====
    // expects delegatecall; claimer and rewardee is `this`
    function claimRewards() override public {
        ERC20Fuzz(address(erc20)).payRewards(address(this));
    }
}
