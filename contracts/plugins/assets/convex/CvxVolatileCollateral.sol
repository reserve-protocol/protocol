// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;
import "./CvxStableCollateral.sol";

/**
 * @title CvxVolatileCollateral
 *  This plugin contract extends CvxCurveStableCollateral to work for
 *  volatile pools like TriCrypto.
 *
 * tok = ConvexStakingWrapper(cvxVolatilePlainPool)
 * ref = cvxVolatilePlainPool pool invariant
 * tar = cvxVolatilePlainPool pool invariant
 * UoA = USD
 */
contract CvxVolatileCollateral is CvxStableCollateral {
    using FixLib for uint192;

    // this isn't saved by our parent classes, but we'll need to track it
    uint192 internal immutable _defaultThreshold; // {1}

    /// @dev config Unused members: chainlinkFeed, oracleError, oracleTimeout
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig
    ) CvxStableCollateral(config, revenueHiding, ptConfig) {
        _defaultThreshold = config.defaultThreshold;
    }

    // Override this later to implement non-stable pools
    function _anyDepeggedInPool() internal view override returns (bool) {
        uint192[] memory balances = getBalances(); // [{tok}]
        uint192[] memory vals = new uint192[](balances.length); // {UoA}
        uint192 valSum; // {UoA}

        // Calculate vals
        for (uint8 i = 0; i < nTokens; i++) {
            try this.tokenPrice(i) returns (uint192 low, uint192 high) {
                // {UoA/tok} = {UoA/tok} + {UoA/tok}
                uint192 mid = (low + high) / 2;

                // {UoA} = {tok} * {UoA/tok}
                vals[i] = balances[i].mul(mid);
                valSum += vals[i];
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                return true;
            }
        }

        // Check distribution of capital
        uint192 expected = FIX_ONE.divu(nTokens); // {1}
        for (uint8 i = 0; i < nTokens; i++) {
            uint192 observed = divuu(vals[i], valSum); // {1}
            if (observed > expected) {
                if (observed - expected > _defaultThreshold) return true;
            }
        }

        return false;
    }
}
