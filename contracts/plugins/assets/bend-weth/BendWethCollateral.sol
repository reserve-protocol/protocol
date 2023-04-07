// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "../OracleLib.sol";
import "./IBToken.sol";
import "./IUIPoolDataProvider.sol";

/**
 * @title BendWethCollateral
 * @notice Collateral plugin for Bend Dao ETH,
 * tok = bendETH
 * ref = ETH
 * tar = ETH
 * UoA = USD
 */
contract BendWethCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    IUiPoolDataProvider public immutable dataProvider;
    address public immutable lendPoolAddressProvider;

    

    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        IUiPoolDataProvider uiPoolDataProvider,
        address _lendPoolAddressProvider
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        dataProvider = uiPoolDataProvider;
        lendPoolAddressProvider = _lendPoolAddressProvider;
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} The actual price observed in the peg
    function tryPrice()
        external
        view
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 pegPrice
        )
    {
        uint192 pricePerRef = chainlinkFeed.price(oracleTimeout); // {UoA/ref}

        // {UoA/tok} = {UoA/ref} * {ref/tok}
        uint192 p = pricePerRef.mul(_underlyingRefPerTok());
        uint192 err = p.mul(oracleError, CEIL);

        low = p - err;
        high = p + err;
        // assert(low <= high); obviously true just by inspection

        pegPrice = targetPerRef(); // ETH/ETH
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        IUiPoolDataProvider.AggregatedReserveData[] memory rate = IUiPoolDataProvider(address(dataProvider)).getSimpleReservesData(ILendPoolAddressesProvider(lendPoolAddressProvider));
        uint128 liquidityIndex = rate[0].liquidityIndex;
        return _safeWrap(liquidityIndex);
    }
}
