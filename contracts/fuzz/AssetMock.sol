// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "contracts/fuzz/ERC20Fuzz.sol";
import "contracts/fuzz/OracleErrorMock.sol";
import "contracts/fuzz/PriceModel.sol";
import "contracts/fuzz/Utils.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/Asset.sol";

contract AssetMock is OracleErrorMock, Asset {
    using FixLib for uint192;
    using PriceModelLib for PriceModel;

    event SetPrice(string symbol, uint192 price);
    PriceModel public model;

    constructor(
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 priceTimeout_,
        uint192 oracleError_,
        PriceModel memory model_
    )
        Asset(
            priceTimeout_, // priceTimeout of 1 week
            AggregatorV3Interface(address(1)), // stub out the expected chainlink oracle
            oracleError_,
            erc20_,
            maxTradeVolume_,
            1 // stub out oracleTimeout
        )
    {
        model = model_;
        emit SetPrice(erc20.symbol(), model.price());
    }

    /// Our best guess at the market price of 1 whole token in UoA
    /// @return low {UoA/tok} The bottom of the plausible price range
    /// @return high {UoA/tok} The top of the plausible price range
    /// @return fnord {UoA/tok} Unusued; here for compatibility with Collateral
    function tryPrice()
        external
        view
        virtual
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 fnord
        )
    {
        maybeFail();
        (low, high) = errRange(model.price(), oracleError);
    }

    function update(uint256 seed) public virtual {
        model.update(uint192(seed));
        emit SetPrice(erc20.symbol(), model.price());
    }

    // ==== Rewards ====
    // expects delegatecall; claimer and rewardee is `this`
    function claimRewards() public override {
        ERC20Fuzz(address(erc20)).payRewards(address(this));
    }
}
