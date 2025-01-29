// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/access/IAccessControlUpgradeable.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { CollateralStatus, ICollateral, IAsset } from "../../../interfaces/IAsset.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "./interfaces/IMidasDataFeed.sol";
import "./interfaces/IMToken.sol";

/**
 * @title MidasCollateral
 * @notice A collateral plugin for Midas tokens (mBTC, mTBILL, mBASIS).
 *
 * ## Scenarios
 *
 * - mBTC:
 *   {target}=BTC, {ref}=BTC => {target/ref}=1.
 *   Need {UoA/target}=USD/BTC from a Chainlink feed.
 *   Price(UoA/tok) = (USD/BTC)*1*(BTC/mBTC) = USD/mBTC
 *
 * - mTBILL/mBASIS:
 *   {target}=USD, {ref}=USDC(=USD) => {target/ref}=1
 *   {UoA/target}=1 (hardcoded, stable USD)
 *   Price(UoA/tok)=1*1*(USDC/token)=USD/token
 *
 * The contract handles both:
 * - If targetName="BTC", must provide a USD/BTC feed for {UoA/target}.
 * - If targetName="USD", no feed needed; {UoA/target}=1.
 *
 * ## Behavior
 * - Uses IMidasDataFeed for {ref/tok}.
 * - For BTC target, uses chainlink feed to get USD/BTC.
 * - For USD target, hardcodes {UoA/target}=1, no feed needed.
 * - On pause: IFFY then DISABLED after delay.
 * - On blacklist: DISABLED immediately.
 * - If refPerTok() decreases: DISABLED (handled by AppreciatingFiatCollateral).
 */
contract MidasCollateral is AppreciatingFiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    error InvalidTargetName();

    bytes32 public constant BLACKLISTED_ROLE = keccak256("BLACKLISTED_ROLE");

    IMidasDataFeed public immutable refPerTokFeed;
    IMToken public immutable mToken;

    AggregatorV3Interface public immutable uoaPerTargetFeed; // {UoA/target}, required if target=BTC
    uint48 public immutable uoaPerTargetFeedTimeout; // {s}, only applicable if target=BTC
    bytes32 public immutable collateralTargetName;

    /**
     * @param config CollateralConfig
     * @param refPerTokFeed_ IMidasDataFeed for {ref/tok}
     * @param revenueHiding (1e-4 for 10 bps)
     */
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        IMidasDataFeed refPerTokFeed_,
        uint48 refPerTokTimeout_
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        require(address(refPerTokFeed_) != address(0), "invalid refPerTok feed");

        mToken = IMToken(address(config.erc20));
        collateralTargetName = config.targetName;
        uoaPerTargetFeed = config.chainlinkFeed;
        uoaPerTargetFeedTimeout = config.oracleTimeout;
        refPerTokFeed = refPerTokFeed_;
    }


    /// @return {ref/tok}
    function underlyingRefPerTok() public view override returns (uint192) {
        uint256 rawPrice = refPerTokFeed.getDataInBase18();
        if (rawPrice > uint256(FIX_MAX)) revert UIntOutOfBounds();
        return uint192(rawPrice);
    }

    /// @return {target/ref}=1 always (BTC/BTC=1, USD/USDC=1)
    function targetPerRef() public pure override returns (uint192) {
        return FIX_ONE;
    }

    /**
     * @dev Calculate price(UoA/tok):
     * price(UoA/tok) = (UoA/target) * (target/ref) * (ref/tok) = (chainlinkFeed price) * 1 * (underlyingRefPerTok())
     *
     * For mBTC: {UoA/target}=USD/BTC, refPerTok=BTC/mBTC => USD/mBTC
     * For mTBILL/mBASIS as mToken: {UoA/target}=USD/USD=1, refPerTok=USDC/mToken (treated as USD), => USD/mToken
     */
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
        uint192 uoaPerTarget;
        if (collateralTargetName == bytes32("BTC")) {
            uoaPerTarget = uoaPerTargetFeed.price(uoaPerTargetFeedTimeout);
        } else {
            uoaPerTarget = FIX_ONE;
        }

        uint192 refPerTok_ = underlyingRefPerTok();

        uint192 p = uoaPerTarget.mul(refPerTok_);
        uint192 err = p.mul(oracleError, CEIL);

        low = p - err;
        high = p + err;

        pegPrice = FIX_ONE;
    }

    /**
     * @dev Checks pause/blacklist state before normal refresh.
     * - Blacklisted => DISABLED
     * - Paused => IFFY then eventually DISABLED
     */
    function refresh() public override {
        CollateralStatus oldStatus = status();

        if (mToken.accessControl().hasRole(BLACKLISTED_ROLE, address(this))) {
            markStatus(CollateralStatus.DISABLED);
        } else if (mToken.paused()) {
            markStatus(CollateralStatus.IFFY);
        } else {
            // Attempt to get refPerTok. If this fails, the feed is stale or invalid.
            try this.underlyingRefPerTok() returns (uint192 /* refValue */) {
                super.refresh();
            } catch (bytes memory errData) {
                if (errData.length == 0) revert();
                markStatus(CollateralStatus.IFFY);
            }
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }
}
