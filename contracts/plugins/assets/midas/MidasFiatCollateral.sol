// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { CollateralStatus } from "../../../interfaces/IAsset.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "./vendor/IMidasDataFeed.sol";
import "./vendor/IMToken.sol";

/**
 * @title MidasFiatCollateral
 * @notice Collateral plugin for USD-based Midas tokens (e.g. mTBILL, mBASIS).
 *
 *   - {tok} = Midas token (e.g. mTBILL)
 *   - {ref} = same as {tok} (the Midas token)
 *   - {target} = USD
 *   - {UoA} = USD
 */
contract MidasFiatCollateral is AppreciatingFiatCollateral {
    using FixLib for uint192;

    bytes32 public constant BLACKLISTED_ROLE = keccak256("BLACKLISTED_ROLE");

    IMToken public immutable mToken;
    IMidasDataFeed public immutable midasFeed;

    /**
     * @param config CollateralConfig
     *   - config.targetName must be "USD"
     *   - config.chainlinkFeed is not used
     *   - config.oracleTimeout is not used
     * @param revenueHiding e.g. 1e-4 = 10 bps
     * @param midasFeed_ A Midas data feed returning {USD/mToken} in 1e18
     */
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        IMidasDataFeed midasFeed_
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        require(config.targetName == bytes32("USD"), "MidasFiatCollateral: targetName must be USD");
        require(address(midasFeed_) != address(0), "MidasFiatCollateral: invalid Midas feed");
        require(config.defaultThreshold != 0, "defaultThreshold zero");

        midasFeed = midasFeed_;
        mToken = IMToken(address(config.erc20));
    }

    function underlyingRefPerTok() public view virtual override returns (uint192) {
        return FIX_ONE;
    }

    /**
     * @return low {UoA/tok} Lower bound of the Midas token's USD price
     * @return high {UoA/tok} Upper bound of the Midas token's USD price
     * @return pegPrice The price of 1 ref in {target/ref}, i.e. 1.0 if {ref} = {tok}, {target} = USD
     */
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
        uint256 rawMidas = midasFeed.getDataInBase18();
        if (rawMidas > type(uint192).max) revert UIntOutOfBounds();
        uint192 p = uint192(rawMidas);

        uint192 err = p.mul(oracleError, CEIL);

        low = p - err;
        high = p + err;
        pegPrice = FIX_ONE;
    }

    /**
     * @notice Check pause/blacklist state before normal refresh flow:
     *   - If blacklisted => DISABLED
     *   - If paused => IFFY => eventually DISABLED
     */
    function refresh() public virtual override {
        CollateralStatus oldStatus = status();

        if (mToken.accessControl().hasRole(BLACKLISTED_ROLE, address(this))) {
            markStatus(CollateralStatus.DISABLED);
        } else if (mToken.paused()) {
            markStatus(CollateralStatus.IFFY);
        } else {
            super.refresh();
        }

        if (status() != oldStatus) {
            emit CollateralStatusChanged(oldStatus, status());
        }
    }
}
