// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/ICToken.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title CTokenFiatCollateral
 * @notice Collateral plugin for a cToken of fiat collateral, like cUSDC or cUSDP
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract CTokenFiatCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // All cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.

    uint8 public immutable referenceERC20Decimals;

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    IComptroller public immutable comptroller;

    /// @param fallbackPrice_ {UoA/tok} A fallback price to use for lot sizing when oracles fail
    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param oracleError_ {1} The % the oracle feed can be off by
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        uint192 oracleError_,
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
            chainlinkFeed_,
            oracleError_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        require(address(comptroller_) != address(0), "comptroller missing");
        defaultThreshold = defaultThreshold_;
        referenceERC20Decimals = IERC20Metadata(erc20_.underlying()).decimals();

        prevReferencePrice = refPerTok();
        comptroller = comptroller_;
    }

    /// Should not revert
    /// @return low {UoA/tok} The lower end of the price estimate
    /// @return high {UoA/tok} The upper end of the price estimate
    function price() public view virtual returns (uint192 low, uint192 high) {
        try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
            // {UoA/tok} = {UoA/ref} * {ref/tok}
            uint192 _price = p.mul(refPerTok());

            // {UoA/tok} = {UoA/tok} * {1}
            uint192 priceErr = _price.mul(oracleError);
            return (_price - priceErr, _price + priceErr);
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
            try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
                // Check for soft default of underlying reference token
                // D18{UoA/ref} = D18{UoA/target} * D18{target/ref} / D18
                uint192 peg = (pricePerTarget() * targetPerRef()) / FIX_ONE;

                // D18{UoA/ref}= D18{UoA/ref} * D18{1} / D18
                uint192 delta = (peg * defaultThreshold) / FIX_ONE; // D18{UoA/ref}

                // If the price is below the default-threshold price, default eventually
                // uint192(+/-) is the same as Fix.plus/minus
                if (p < peg - delta || p > peg + delta) markStatus(CollateralStatus.IFFY);
                else {
                    // {UoA/tok} = {UoA/ref} * {ref/tok}
                    _fallbackPrice = p.mul(refPerTok());

                    markStatus(CollateralStatus.SOUND);
                }
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
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

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev delegatecall
    function claimRewards() external virtual override {
        IERC20 comp = IERC20(comptroller.getCompAddress());
        uint256 oldBal = comp.balanceOf(address(this));
        comptroller.claimComp(address(this));
        emit RewardsClaimed(comp, comp.balanceOf(address(this)) - oldBal);
    }
}
