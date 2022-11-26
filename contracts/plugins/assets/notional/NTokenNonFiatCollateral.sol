// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "contracts/plugins/assets/notional/INotionalProxy.sol";
import "contracts/plugins/assets/notional/INTokenERC20Proxy.sol";
import "contracts/plugins/assets/notional/NTokenFiatCollateral.sol";
import "contracts/plugins/assets/RevenueHiding.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title NTokenNonFiatCollateral
 * @notice Collateral plugin for a NToken of non fiat collateral
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} != {UoA}
 */
contract NTokenNonFiatCollateral is NTokenFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    AggregatorV3Interface public immutable uoaPerTargetFeed;

    constructor(
        uint192 _fallbackPrice,
        AggregatorV3Interface _targetPerRefFeed,
        AggregatorV3Interface _uoaPerTargetFeed,
        IERC20Metadata _erc20Collateral,
        uint192 _maxTradeVolume,
        uint48 _oracleTimeout,
        uint16 _allowedDrop,
        bytes32 _targetName,
        uint256 _delayUntilDefault,
        address _notionalProxy,
        uint192 _defaultThreshold
    )
    NTokenFiatCollateral(
        _fallbackPrice,
        _targetPerRefFeed,
        _erc20Collateral,
        _maxTradeVolume,
        _oracleTimeout,
        _allowedDrop,
        _targetName,
        _delayUntilDefault,
        _notionalProxy,
        _defaultThreshold
    )
    {
        require(address(_uoaPerTargetFeed) != address(0), "missing chainlink uaePerTarget feed");

        uoaPerTargetFeed = _uoaPerTargetFeed;
    }

    /// Can return 0, can revert
    /// Shortcut for price(false)
    /// @return {UoA/tok} The current price(), without considering fallback prices
    function strictPrice() external view override returns (uint192) {
        uint192 targetPerRef = chainlinkFeed.price(oracleTimeout).mul(actualRefPerTok());
        uint192 uoaPerTarget = uoaPerTargetFeed.price(oracleTimeout);
        return targetPerRef.mul(uoaPerTarget);
    }
}
