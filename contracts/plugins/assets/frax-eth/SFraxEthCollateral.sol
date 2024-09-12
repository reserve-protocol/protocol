// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "../OracleLib.sol";
import "./vendor/IsfrxEth.sol";

interface IEmaPriceOracleStableSwap {
    // solhint-disable-next-line func-name-mixedcase
    function price_oracle() external view returns (uint256);
}

/**
 * @title SFraxEthCollateral
 * @notice Collateral plugin for Frax-ETH,
 * tok = sfrxETH
 * ref = frxETH
 * tar = ETH
 * UoA = USD
 */
contract SFraxEthCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // solhint-disable-next-line var-name-mixedcase
    address public immutable CURVE_POOL_EMA_PRICE_ORACLE;

    /// @param config.chainlinkFeed {UoA/target} price of ETH in USD terms
    /// @param revenueHiding {1e18} percent amount of revenue to hide
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        address curvePoolEmaPriceOracleAddress
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        require(config.defaultThreshold != 0, "defaultThreshold zero");

        CURVE_POOL_EMA_PRICE_ORACLE = curvePoolEmaPriceOracleAddress;
    }

    function refresh() public virtual override {
        // solhint-disable-next-line no-empty-blocks
        try IsfrxEth(address(erc20)).syncRewards() {} catch {}

        super.refresh();
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should NOT be manipulable by MEV
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
        // {target/ref} Get current market peg ({eth/frxeth})
        pegPrice = _safeWrap(IEmaPriceOracleStableSwap(CURVE_POOL_EMA_PRICE_ORACLE).price_oracle());

        // {UoA/tok} = {UoA/target} * {target/ref} * {ref/tok}
        uint192 p = chainlinkFeed.price(oracleTimeout).mul(pegPrice).mul(underlyingRefPerTok());
        uint192 err = p.mul(oracleError, CEIL);

        high = p + err;
        low = p - err;
        // assert(low <= high); obviously true just by inspection
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view override returns (uint192) {
        return _safeWrap(IsfrxEth(address(erc20)).pricePerShare());
    }
}
