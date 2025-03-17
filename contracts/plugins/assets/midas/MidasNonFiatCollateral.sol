// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { CollateralStatus } from "../../../interfaces/IAsset.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "./vendor/IMidasDataFeed.sol";
import "./vendor/IMToken.sol";

/**
 * @title MidasNonFiatCollateral
 * @notice Collateral plugin for BTC-based Midas tokens (e.g. mBTC).
 *
 *   - {tok} = mBTC
 *   - {ref} = BTC
 *   - {target} = BTC
 *   - {UoA} = USD
 */
contract MidasNonFiatCollateral is AppreciatingFiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    IMToken public immutable mToken;
    IMidasDataFeed public immutable refPerTokFeed; // {ref/tok} = BTC/mBTC in 1e18
    AggregatorV3Interface public immutable uoaPerTargetFeed; // {UoA/target} = USD/BTC
    uint48 public immutable uoaPerTargetFeedTimeout;
    bytes32 public constant BLACKLISTED_ROLE = keccak256("BLACKLISTED_ROLE");

    /**
     * @param config CollateralConfig
     *   - config.targetName must be "BTC"
     *   - config.chainlinkFeed must be the USD/BTC Chainlink feed
     *   - config.oracleTimeout must be the timeout for the USD/BTC Chainlink feed
     * @param revenueHiding e.g. 1e-4 = 10 bps revenue hiding
     * @param refPerTokFeed_ Midas data feed returning {BTC/mBTC} in 1e18
     */
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        IMidasDataFeed refPerTokFeed_
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        require(
            config.targetName == bytes32("BTC"),
            "MidasNonFiatCollateral: targetName must be BTC"
        );
        require(
            address(refPerTokFeed_) != address(0),
            "MidasNonFiatCollateral: invalid refPerTok feed"
        );
        require(config.defaultThreshold != 0, "defaultThreshold zero");
        require(
            address(config.chainlinkFeed) != address(0),
            "MidasNonFiatCollateral: missing chainlink feed"
        );

        refPerTokFeed = refPerTokFeed_;
        mToken = IMToken(address(config.erc20));
        uoaPerTargetFeed = config.chainlinkFeed;
        uoaPerTargetFeedTimeout = config.oracleTimeout;
    }

    /// @return {ref/tok} = BTC per mBTC, from the Midas data feed
    function underlyingRefPerTok() public view virtual override returns (uint192) {
        uint256 raw = refPerTokFeed.getDataInBase18();
        if (raw > type(uint192).max) revert UIntOutOfBounds();
        return uint192(raw);
    }

    /**
     * @return low {UoA/tok} Lower bound of the Midas token's USD price
     * @return high {UoA/tok} Upper bound of the Midas token's USD price
     * @return pegPrice {target/ref} The ratio of BTC to BTC, i.e. 1
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
        // {UoA/target} = USD/BTC (Chainlink)
        uint192 uoaPerBTC = uoaPerTargetFeed.price(uoaPerTargetFeedTimeout);

        // {ref/tok} = BTC/mBTC (Midas feed)
        uint192 btcPerMToken = underlyingRefPerTok();

        // p = (USD/BTC) * (BTC/mToken) = USD/mToken
        uint192 p = uoaPerBTC.mul(btcPerMToken);

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
