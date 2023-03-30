// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

import "../../../interfaces/IRTokenOracle.sol";
import "./CvxStableMetapoolCollateral.sol";

/**
 * @title CvxStableRTokenMetapoolCollateral
 *  This plugin contract is intended for 2-token stable metapools that
 *  involve RTokens, such as eUSD-fraxBP.
 *
 * tok = ConvexStakingWrapper(cvxPairedUSDRToken/USDBasePool)
 * ref = PairedUSDRToken/USDBasePool pool invariant
 * tar = USD
 * UoA = USD
 */
contract CvxStableRTokenMetapoolCollateral is CvxStableMetapoolCollateral {
    using FixLib for uint192;

    IRTokenOracle public immutable rTokenOracle;

    /// @dev config.chainlinkFeed/oracleError/oracleTimeout are unused; set chainlinkFeed to 0x1
    /// @dev config.erc20 should be a IConvexStakingWrapper
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig,
        ICurveMetaPool metapoolToken_,
        uint192 pairedTokenDefaultThreshold_,
        IRTokenOracle rTokenOracle_
    )
        CvxStableMetapoolCollateral(
            config,
            revenueHiding,
            ptConfig,
            metapoolToken_,
            pairedTokenDefaultThreshold_
        )
    {
        require(address(rTokenOracle_) != address(0), "rTokenOracle missing");
        rTokenOracle = rTokenOracle_;
    }

    /// Can revert, used by `_anyDepeggedOutsidePool()`
    /// Should not return FIX_MAX for low
    /// Should only return FIX_MAX for high if low is 0
    /// @return lowPaired {UoA/pairedTok} The low price estimate of the paired token
    /// @return highPaired {UoA/pairedTok} The high price estimate of the paired token
    function tryPairedPrice()
        public
        view
        virtual
        override
        returns (uint192 lowPaired, uint192 highPaired)
    {
        // refresh price in oracle if needed
        (Price memory p, ) = rTokenOracle.priceView(IRToken(address(pairedToken)), false);
        return (p.low, p.high);
    }

    /// Should not revert (other than out-of-gas error / empty data)
    /// Refresh exchange rates and update default status.
    /// Have to override to add custom default checks
    function refresh() public virtual override {
        // refresh price in rTokenOracle
        try rTokenOracle.price(IRToken(address(pairedToken)), false) {} catch (
            bytes memory errData
        ) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            markStatus(CollateralStatus.IFFY);
        }
        super.refresh();
    }
}
