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

    uint192 public immutable targetUnitOracleError; // {1} The max % error,  target unit oracle

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    IComptroller public immutable comptroller;

    uint8 public immutable referenceERC20Decimals;

    /// @param fallbackPrice_ {UoA/tok} A fallback price to use for lot sizing when oracles fail
    /// @param refUnitChainlinkFeed_ Feed units: {target/ref}
    /// @param refUnitOracleError_ {1} The % the ref unit oracle feed can be off by
    /// @param targetUnitUSDChainlinkFeed_ Feed units: {UoA/target}
    /// @param targetUnitOracleError_ {1} The % the target unit oracle feed can be off by
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface refUnitChainlinkFeed_,
        uint192 refUnitOracleError_,
        AggregatorV3Interface targetUnitUSDChainlinkFeed_,
        uint192 targetUnitOracleError_,
        ICToken erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IComptroller comptroller_
    )
        Collateral(
            fallbackPrice_,
            refUnitChainlinkFeed_,
            refUnitOracleError_,
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
        require(address(comptroller_) != address(0), "comptroller missing");
        defaultThreshold = defaultThreshold_;
        targetUnitChainlinkFeed = targetUnitUSDChainlinkFeed_;
        targetUnitOracleError = targetUnitOracleError_;
        referenceERC20Decimals = IERC20Metadata(erc20_.underlying()).decimals();
        prevReferencePrice = refPerTok();
        comptroller = comptroller_;
    }

    /// Should not revert
    /// @return low {UoA/tok} The lower end of the price estimate
    /// @return high {UoA/tok} The upper end of the price estimate
    function price() public view virtual returns (uint192 low, uint192 high) {
        try chainlinkFeed.price_(oracleTimeout) returns (uint192 p1) {
            try targetUnitChainlinkFeed.price_(oracleTimeout) returns (uint192 p2) {
                // {UoA/tok} = {UoA/target} * {target/ref} * {ref/tok}
                uint192 _price = p2.mul(p1).mul(refPerTok());

                // {1} = {1} * {1}
                uint192 totalOracleError = oracleError
                    .mul(FIX_ONE.plus(targetUnitOracleError))
                    .minus(FIX_ONE);

                // {UoA/tok} = {UoA/tok} * {1}
                uint192 priceErr = _price.mul(totalOracleError);
                return (_price - priceErr, _price + priceErr);
            } catch {
                return (0, FIX_MAX);
            }
        } catch {
            return (0, FIX_MAX);
        }
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
            try chainlinkFeed.price_(oracleTimeout) returns (uint192 p1) {
                // We don't need the return value from this next feed, but it should still function
                try targetUnitChainlinkFeed.price_(oracleTimeout) returns (uint192 p2) {
                    // {target/ref}
                    uint192 peg = targetPerRef();

                    // D18{target/ref}= D18{target/ref} * D18{1} / D18
                    uint192 delta = (peg * defaultThreshold) / FIX_ONE;

                    // If the price is below the default-threshold price, default eventually
                    // uint192(+/-) is the same as Fix.plus/minus
                    if (p1 < peg - delta || p1 > peg + delta) markStatus(CollateralStatus.IFFY);
                    else {
                        // {UoA/tok} = {UoA/target} * {target/ref} * {ref/tok}
                        _fallbackPrice = p2.mul(p1).mul(refPerTok());

                        markStatus(CollateralStatus.SOUND);
                    }
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
        int8 shiftLeft = 8 - int8(referenceERC20Decimals) - 18;
        return shiftl_toFix(rate, shiftLeft);
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() internal view override returns (uint192) {
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
