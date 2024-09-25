// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../assets/Asset.sol";
import "../assets/AppreciatingFiatCollateral.sol";
import "../assets/OracleLib.sol";

contract UnpricedAssetMock is Asset {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    bool public unpriced = false;

    /// @param priceTimeout_ {s} The number of seconds over which savedHighPrice decays to 0
    /// @param chainlinkFeed_ Feed units: {UoA/tok}
    /// @param oracleError_ {1} The % the oracle feed can be off by
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    constructor(
        uint48 priceTimeout_,
        AggregatorV3Interface chainlinkFeed_,
        uint192 oracleError_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_
    ) Asset(priceTimeout_, chainlinkFeed_, oracleError_, erc20_, maxTradeVolume_, oracleTimeout_) {}

    /// tryPrice: mock unpriced by returning (0, FIX_MAX)
    function tryPrice()
        external
        view
        override
        returns (
            uint192 low,
            uint192 high,
            uint192
        )
    {
        // If unpriced is marked, return 0, FIX_MAX
        if (unpriced) return (0, FIX_MAX, 0);

        uint192 p = chainlinkFeed.price(oracleTimeout); // {UoA/tok}
        uint192 delta = p.mul(oracleError, CEIL);
        return (p - delta, p + delta, 0);
    }

    function setUnpriced(bool on) external {
        unpriced = on;
    }
}

contract UnpricedFiatCollateralMock is FiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    bool public unpriced = false;

    // solhint-disable no-empty-blocks

    constructor(CollateralConfig memory config) FiatCollateral(config) {}

    /// tryPrice: mock unpriced by returning (0, FIX_MAX)
    function tryPrice()
        external
        view
        virtual
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 pegPrice
        )
    {
        // If unpriced is marked, return 0, FIX_MAX
        if (unpriced) return (0, FIX_MAX, 0);

        // {target/ref} = {UoA/ref} / {UoA/target} (1)
        pegPrice = chainlinkFeed.price(oracleTimeout);

        // {target/ref} = {target/ref} * {1}
        uint192 err = pegPrice.mul(oracleError, CEIL);

        low = pegPrice - err;
        high = pegPrice + err;
        // assert(low <= high); obviously true just by inspection
    }

    function setUnpriced(bool on) external {
        unpriced = on;
    }
}

contract UnpricedAppreciatingFiatCollateralMock is AppreciatingFiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    bool public unpriced = false;

    uint192 public mockRefPerTok = FIX_ONE;

    // solhint-disable no-empty-blocks

    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {}

    /// tryPrice: mock unpriced by returning (0, FIX_MAX)
    function tryPrice()
        external
        view
        virtual
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 pegPrice
        )
    {
        // If unpriced is marked, return 0, FIX_MAX
        if (unpriced) return (0, FIX_MAX, 0);

        // {target/ref} = {UoA/ref} / {UoA/target} (1)
        pegPrice = chainlinkFeed.price(oracleTimeout);

        // {UoA/tok} = {target/ref} * {ref/tok} * {UoA/target} (1)
        uint192 p = pegPrice.mul(underlyingRefPerTok());
        uint192 err = p.mul(oracleError, CEIL);

        low = p - err;
        high = p + err;
        // assert(low <= high); obviously true just by inspection
    }

    /// Mock function, required but not used in tests
    function underlyingRefPerTok() public view override returns (uint192) {
        return mockRefPerTok;
    }

    function setUnpriced(bool on) external {
        unpriced = on;
    }
}
