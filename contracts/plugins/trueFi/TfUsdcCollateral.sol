// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../assets/AbstractCollateral.sol";
import "./poolContracts/ITrueFiPool2.sol";
import "../../libraries/Fixed.sol";

/**
 * @title TfUsdcCollateral
 * @notice Collateral plugin for tfUSDC collateral
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 * Other TrueFi Lending Pool Collaterals can be created from this by making very few changes
 */
contract TfUsdcCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // tfUSDC and USDC both have 6 decimals.
    int8 public immutable referenceERC20Decimals; // 6

    uint192 public immutable defaultThreshold; // 0.05

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    IERC20 public immutable truToken; // For rewards later

    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param poolAddress_ Address of tfUSDC/USDC lending pool
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    /// @param truToken_ Address of tru token
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        address poolAddress_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        int8 referenceERC20Decimals_,
        IERC20 truToken_
    )
        Collateral(
            fallbackPrice_,
            chainlinkFeed_,
            ERC20(poolAddress_),
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        require(referenceERC20Decimals_ > 0, "referenceERC20Decimals missing");
        require(address(truToken_) != address(0), "Invalid tru address");
        defaultThreshold = defaultThreshold_;
        referenceERC20Decimals = referenceERC20Decimals_;

        prevReferencePrice = refPerTok();
        truToken = truToken_;
    }

    /// @return {UoA/tok} market price of 1 whole token in UoA
    function strictPrice() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        return chainlinkFeed.price(oracleTimeout).mul(refPerTok());
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        // No need to update state if already defaulted
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
                else markStatus(CollateralStatus.SOUND);
            } catch (bytes memory errData) {
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        ITrueFiPool2 tfToken = ITrueFiPool2(address(erc20));
        // {ref/tok}=poolValue()/totalSupply()
        uint256 val = toFix(tfToken.poolValue()).div(toFix(tfToken.totalSupply()));
        int8 shiftLeft = 6 - referenceERC20Decimals - 18;
        return shiftl_toFix(val, shiftLeft);
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev delegatecall
    /// does nothing for now
    function claimRewards() external virtual override {
        IERC20 tru = IERC20(truToken);
        emit RewardsClaimed(tru, 0);
    }
}
