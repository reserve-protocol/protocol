// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../..//libraries/Fixed.sol";
import "../AbstractCollateral.sol";
import "./IgOHM.sol";

/**
 * @title gOHM Collateral
 * {tok} == gOHM
 * {ref} == OHM
 * {target} == OHM
 * {UoA} == USD
 * This collateral can default if the oracle becomes stale for long enough or refPerTok decrease
 */
contract GOhmCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    AggregatorV3Interface public immutable ethPerRefChainlinkFeed;
    AggregatorV3Interface public immutable uoaPerEthChainlinkFeed;

    int8 public immutable referenceERC20Decimals;
    uint192 public prevReferencePrice; //  {ref/tok} previous rate

    /// @param fallbackPrice_ price when feeds fail
    /// @param ethPerRefChainlinkFeed_ Feed units: {ETH/OHM}
    /// @param uoaPerEthChainlinkFeed_ Feed units: {USD/ETH}
    /// @param erc20_ {tok} address
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param targetName_ {target} name in bytes32
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    /// @param referenceERC20Decimals_ decimals of {ref}
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface ethPerRefChainlinkFeed_,
        AggregatorV3Interface uoaPerEthChainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint256 delayUntilDefault_,
        int8 referenceERC20Decimals_
    )
        Collateral(
            fallbackPrice_,
            ethPerRefChainlinkFeed_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(address(uoaPerEthChainlinkFeed_) != address(0), "missing uoaPerEthChainlinkFeed_");
        require(referenceERC20Decimals_ > 0, "referenceERC20Decimals missing");

        ethPerRefChainlinkFeed = ethPerRefChainlinkFeed_;
        uoaPerEthChainlinkFeed = uoaPerEthChainlinkFeed_;
        referenceERC20Decimals = referenceERC20Decimals_;
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        // == Refresh ==

        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            // checking chainlink feeds for stale price
            try this.pricePerTarget_() returns (uint192) {
                markStatus(CollateralStatus.SOUND);
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
        // No interactions beyond the initial refresher
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    /// D9{index} is non-decreasing over time because of the staking rewards
    function refPerTok() public view override returns (uint192) {
        try IgOHM(address(erc20)).index() returns (uint256 rate) {
            int8 shiftLeft = referenceERC20Decimals - 18;
            return shiftl_toFix(rate, shiftLeft);
        } catch (bytes memory errData) {
            /// Revert out of gas error
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            /// smt wrong with the gOHM contract, returning zero to default instantly
            return FIX_ZERO;
        }
    }

    /// @return {UoA/tok} The price of a token unit in UoA
    /// {UoA/tok} does not have a price feed, so best estimate is:
    /// D18{UoA/tok} = D18{UoA/ref} * D18{ref/tok}
    function strictPrice() public view virtual override returns (uint192) {
        return refPerTok().mul(pricePerTarget());
    }

    /// @return {UoA/target} The price of a target unit in UoA
    /// D18{UoA/target} does not have a price feed, so calculate as follow:
    /// D18{UoA/target} = D18{UoA/ETH} * D18{ETH/target}
    /// using ethPerRefChainlinkFeed as {ETH/ref} because {ref} = {target}
    function pricePerTarget() public view virtual override returns (uint192) {
        uint192 usdPerEth = uoaPerEthChainlinkFeed.price(oracleTimeout);
        uint192 ethPerTarget = ethPerRefChainlinkFeed.price(oracleTimeout);
        return usdPerEth.mul(ethPerTarget);
    }

    /// @dev Use when a try-catch is necessary
    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget_() external view returns (uint192) {
        return pricePerTarget();
    }
}
