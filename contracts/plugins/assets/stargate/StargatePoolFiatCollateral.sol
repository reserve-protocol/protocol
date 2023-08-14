// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../../libraries/Fixed.sol";
import "../OracleLib.sol";
import "../FiatCollateral.sol";
import "./interfaces/IStargatePool.sol";

import "./StargateRewardableWrapper.sol";

contract StargatePoolFiatCollateral is FiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    // does not become nonzero until after first refresh()
    uint192 public lastReferencePrice; // {ref/tok} last ref price observed

    IStargatePool private immutable pool;

    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    // solhint-disable no-empty-blocks
    constructor(CollateralConfig memory config) FiatCollateral(config) {
        pool = StargateRewardableWrapper(address(config.erc20)).pool();
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should not return FIX_MAX for low
    /// Should only return FIX_MAX for high if low is 0
    /// @dev Override this when pricing is more complicated than just a single oracle
    /// @param low {UoA/tok} The low price estimate
    /// @param high {UoA/tok} The high price estimate
    /// @param pegPrice {target/tok} The actual price observed in the peg
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
        pegPrice = chainlinkFeed.price(oracleTimeout); // {target/ref}

        // Assumption: {UoA/target} = 1; target is same as UoA
        // {UoA/tok} = {UoA/target} * {target/ref} * {ref/tok}
        uint192 p = pegPrice.mul(refPerTok());

        // {UoA/tok} = {UoA/tok} * {1}
        uint192 delta = p.mul(oracleError);

        low = p - delta;
        high = p + delta;
    }

    /// Should not revert
    /// Refresh exchange rates and update default status.
    /// @dev Should not need to override: can handle collateral with variable refPerTok()
    function refresh() public virtual override {
        if (alreadyDefaulted()) return;

        CollateralStatus oldStatus = status();

        // Check for hard default

        uint192 referencePrice = refPerTok();
        uint192 lastReferencePrice_ = lastReferencePrice;

        // uint192(<) is equivalent to Fix.lt
        if (referencePrice < lastReferencePrice_) {
            markStatus(CollateralStatus.DISABLED);
        } else if (referencePrice > lastReferencePrice_) {
            lastReferencePrice = referencePrice;
        }

        // Check for soft default + save prices
        try this.tryPrice() returns (uint192 low, uint192 high, uint192 pegPrice) {
            // {UoA/tok}, {UoA/tok}, {target/ref}
            // (0, 0) is a valid price; (0, FIX_MAX) is unpriced

            // Save prices if priced
            if (high < FIX_MAX) {
                savedLowPrice = low;
                savedHighPrice = high;
                lastSave = uint48(block.timestamp);
            } else {
                // must be unpriced
                assert(low == 0);
            }

            // If the price is below the default-threshold price, default eventually
            // uint192(+/-) is the same as Fix.plus/minus
            if (pegPrice < pegBottom || pegPrice > pegTop || low == 0) {
                markStatus(CollateralStatus.IFFY);
            } else {
                markStatus(CollateralStatus.SOUND);
            }
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            markStatus(CollateralStatus.IFFY);
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return _rate {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view virtual override returns (uint192 _rate) {
        uint256 _totalSupply = pool.totalSupply();

        if (_totalSupply != 0) {
            _rate = divuu(pool.totalLiquidity(), _totalSupply);
        } else {
            // In case the pool has no tokens at all, the rate is 1:1
            _rate = FIX_ONE;
        }
    }

    function claimRewards() external override(Asset, IRewardable) {
        StargateRewardableWrapper(address(erc20)).claimRewards();
    }
}
