// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import "../ERC4626FiatCollateral.sol";
import "../../../libraries/Fixed.sol";

/**
 * @title Origin Dollar Collateral for Mainnet
 * @notice tok = wOUSD, ref = OUSD, tar = USD, UoA = USD
 * @dev WARNING: Assumes 1 OUSD = 1 USD. This plugin does not detect OUSD depegs or
 * backing losses that do not reduce the wrapper's OUSD/wOUSD exchange rate.
 */
contract OUSDCollateral is ERC4626FiatCollateral {
    using FixLib for uint192;

    /// @param config.chainlinkFeed Ignored, but must be nonzero for Asset validation
    /// @param config.oracleTimeout Delays saved-price decay on wrapper failure; no feed expiry
    /// @param config.oracleError Pricing margin, not protection against an OUSD depeg
    /// @param revenueHiding {1} Maximum fraction of refPerTok to hide
    // solhint-disable no-empty-blocks
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        ERC4626FiatCollateral(config, revenueHiding)
    {}

    // solhint-enable no-empty-blocks

    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} Assumes 1 USD/OUSD
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
        // {UoA/tok} = {ref/tok}, assuming 1 USD/OUSD
        uint192 p = underlyingRefPerTok();
        uint192 err = p.mul(oracleError, CEIL);
        return (p - err, p + err, FIX_ONE);
    }
}
