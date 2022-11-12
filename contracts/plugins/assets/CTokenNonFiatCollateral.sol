// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/ICToken.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title CTokenNonFiatCollateral
 * @notice Collateral plugin for a cToken of nonfiat collateral that requires default checks,
 * like cWBTC. Expected: {tok} != {ref}, {ref} == {target}, {target} != {UoA}
 */
contract CTokenNonFiatCollateral is Collateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    /// Should not use Collateral.chainlinkFeed, since naming is ambiguous

    AggregatorV3Interface public immutable targetUnitChainlinkFeed; // {UoA/target}

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    IComptroller public immutable comptroller;

    int8 public immutable referenceERC20Decimals;

    /// @param refUnitChainlinkFeed_ Feed units: {target/ref}
    /// @param targetUnitUSDChainlinkFeed_ Feed units: {UoA/target}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface refUnitChainlinkFeed_,
        AggregatorV3Interface targetUnitUSDChainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        int8 referenceERC20Decimals_,
        IComptroller comptroller_
    )
        Collateral(
            fallbackPrice_,
            refUnitChainlinkFeed_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        require(
            address(targetUnitUSDChainlinkFeed_) != address(0),
            "missing target unit chainlink feed"
        );
        require(referenceERC20Decimals_ > 0, "referenceERC20Decimals missing");
        require(address(comptroller_) != address(0), "comptroller missing");
        defaultThreshold = defaultThreshold_;
        targetUnitChainlinkFeed = targetUnitUSDChainlinkFeed_;
        referenceERC20Decimals = referenceERC20Decimals_;
        prevReferencePrice = refPerTok();
        comptroller = comptroller_;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function strictPrice() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/target} * {target/ref} * {ref/tok}
        return
            targetUnitChainlinkFeed
                .price(oracleTimeout)
                .mul(chainlinkFeed.price(oracleTimeout))
                .mul(refPerTok());
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        // == Refresh ==
        // Update the Compound Protocol
        ICToken(address(erc20)).exchangeRateCurrent();

        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            // p {target/ref}
            try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
                // We don't need the return value from this next feed, but it should still function
                try targetUnitChainlinkFeed.price_(oracleTimeout) returns (uint192) {
                    // {target/ref}
                    uint192 peg = targetPerRef();

                    // D18{target/ref}= D18{target/ref} * D18{1} / D18
                    uint192 delta = (peg * defaultThreshold) / FIX_ONE;

                    // If the price is below the default-threshold price, default eventually
                    // uint192(+/-) is the same as Fix.plus/minus
                    if (p < peg - delta || p > peg + delta) markStatus(CollateralStatus.IFFY);
                    else markStatus(CollateralStatus.SOUND);
                } catch (bytes memory errData) {
                    // see: docs/solidity-style.md#Catching-Empty-Data
                    if (errData.length == 0) revert(); // solhint-disable-line reason-string
                    markStatus(CollateralStatus.IFFY);
                }
            } catch (bytes memory errData) {
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }

        // No interactions beyond the initial refresher
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        uint256 rate = ICToken(address(erc20)).exchangeRateStored();
        int8 shiftLeft = 8 - referenceERC20Decimals - 18;
        return shiftl_toFix(rate, shiftLeft);
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return targetUnitChainlinkFeed.price(oracleTimeout);
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev delegatecall
    function claimRewards() external virtual override {
        IERC20 comp = IERC20(comptroller.getCompAddress());
        uint256 oldBal = comp.balanceOf(address(this));
        comptroller.claimComp(address(this));
        emit RewardsClaimed(comp, comp.balanceOf(address(this)) - oldBal);
    }
}
