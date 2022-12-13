// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../assets/AbstractCollateral.sol";
import "./ITFToken.sol";
import "../../libraries/Fixed.sol";

/**
 * @title TFTokenFiatCollateral
 * @notice Collateral plugin for a cToken of fiat collateral, like cUSDC or cUSDP
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract TFTokenCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // All cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.

    // Token TrueFi USD Coin: https://etherscan.io/token/0xa991356d261fbaf194463af6df8f0464f8f1c742
    // All TrueFiTokens have 6 decimals, their underlying(USDC) also has 6 decimals.
    // USDC: https://etherscan.io/token/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48

    //int8 public immutable referenceERC20Decimals; -- why we removed? #mention

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    ITRUFarm public immutable trufarm;

    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        ITRUFarm trufarm_
    )
        Collateral(
            fallbackPrice_,
            chainlinkFeed_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        //require(referenceERC20Decimals_ > 0, "referenceERC20Decimals missing");
        defaultThreshold = defaultThreshold_;
        //referenceERC20Decimals = referenceERC20Decimals_;

        prevReferencePrice = refPerTok();

        trufarm = trufarm_;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function strictPrice() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        return chainlinkFeed.price(oracleTimeout).mul(refPerTok());
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        // == Refresh ==
        // Update the Compound Protocol
        //ITFToken(address(erc20)).poolValue() / ITFToken(address(erc20)).totalSupply();

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
    function refPerTok() public view override returns (uint192) {
        // uint256 rate = ITFToken(address(erc20)).poolValue() / ITFToken(address(erc20)).totalSupply();
        // //int8 shiftLeft = 6 - referenceERC20Decimals - 18;
        // return shiftl_toFix(rate, -0);
        ITFToken tfToken = ITFToken(address(erc20));
        uint192 pv = shiftl_toFix(tfToken.poolValue(), -6);
        uint192 ts = shiftl_toFix(tfToken.totalSupply(), -6);
        return pv.div(ts);
    }

    // / Claim rewards earned by holding a balance of the ERC20 token
    // / @dev delegatecall
    function claimRewards() external virtual override {
        IERC20 tru = IERC20(trufarm.rewardToken());
        uint256 amount = trufarm.claimable(address(erc20), address(this));
        address[] memory tokens_ = new address[](1);
        tokens_[0] = address(erc20);
        trufarm.claim(tokens_);
        emit RewardsClaimed(tru, amount);
    }
}
