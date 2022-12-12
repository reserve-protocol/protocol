// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/RevenueHiding.sol";
import "contracts/plugins/assets/notional-fixed/IReservefCashWrapper.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title fCashFiatPeggedCollateral
 * @notice Collateral plugin for fCash lending positions where lent underlying is Fiat pegged
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract fCashFiatPeggedCollateral is RevenueHiding {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    IReservefCashWrapper private immutable fCashWrapper;
    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    /// @param _fallbackPrice {UoA} Price to be returned in worst case
    /// @param _targetPerRefFeed Feed units: {UoA/ref}
    /// @param _erc20Collateral Asset that the plugin manages
    /// @param _maxTradeVolume {UoA} The max trade volume, in UoA
    /// @param _oracleTimeout {s} The number of seconds until a oracle value becomes invalid
    /// @param _allowedDropBasisPoints {bps} Max drop allowed on refPerTok before defaulting
    /// @param _targetName Name of category
    /// @param _delayUntilDefault {s} The number of seconds deviation must occur before default
    /// @param _defaultThreshold {%} A value like 0.05 that represents a deviation tolerance
    constructor(
        uint192 _fallbackPrice,
        AggregatorV3Interface _targetPerRefFeed,
        IERC20Metadata _erc20Collateral,
        uint192 _maxTradeVolume,
        uint48 _oracleTimeout,
        uint16 _allowedDropBasisPoints,
        bytes32 _targetName,
        uint256 _delayUntilDefault,
        uint192 _defaultThreshold
    )
    RevenueHiding(
        _fallbackPrice,
        _targetPerRefFeed,
        _erc20Collateral,
        _maxTradeVolume,
        _oracleTimeout,
        _allowedDropBasisPoints,
        _targetName,
        _delayUntilDefault
    )
    {
        require(_defaultThreshold > 0 && _defaultThreshold < FIX_ONE, "invalid defaultThreshold");

        fCashWrapper = IReservefCashWrapper(address(_erc20Collateral));
        defaultThreshold = _defaultThreshold;
    }

    function _beforeRefreshing() internal override {
        // try to reinvest any matured positions
        try fCashWrapper.reinvest() {
            // if all goes well, nothing to do
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string

            /// @dev this could happen when we are trying to re-invest
            ///   too much liquidity and the market can't keep positive rates
            ///   after our trade.
            ///
            /// We could possibly change the strategy to split the assets on
            /// different markets when this happens.
        }
    }

    function checkReferencePeg() internal virtual override {
        try chainlinkFeed.price_(oracleTimeout) returns (uint192 currentPrice) {
            // the peg of our reference is always ONE target
            uint192 peg = FIX_ONE;

            // since peg is ONE we dont need to operate the threshold to get the delta
            // therefore, defaultThreshold == delta

            // If the price is below the default-threshold price, default eventually
            // uint192(+/-) is the same as Fix.plus/minus
            if (
                currentPrice < peg - defaultThreshold ||
                currentPrice > peg + defaultThreshold
            ) {
                markStatus(CollateralStatus.IFFY);
            }
            else {
                markStatus(CollateralStatus.SOUND);
            }
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert();
            // solhint-disable-line reason-string
            markStatus(CollateralStatus.IFFY);
        }
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function actualRefPerTok() public view override returns (uint192) {
        return _safeWrap(fCashWrapper.refPerTok());
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// Must emit `RewardsClaimed` for each token rewards are claimed for
    /// @dev delegatecall: let there be dragons!
    /// @custom:interaction
    function claimRewards() external override {}
}
