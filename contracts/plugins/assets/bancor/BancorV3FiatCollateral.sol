// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/ICToken.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/bancor/IBnTokenERC20.sol";
import "contracts/plugins/assets/bancor/IStandardRewards.sol";
import "hardhat/console.sol";

/**
 * @title CTokenFiatCollateral
 * @notice Collateral plugin for a cToken of fiat collateral, like cUSDC or cUSDP
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract BancorV3FiatCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    int8 public immutable ERC20Decimals;

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    IBnTokenERC20 public immutable bnToken;

    IStandardRewards public immutable StandardRewards;

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}


    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
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
        int8 ERC20Decimals_,
        address bnToken_,
        address StandardRewards_
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
        require(address(bnToken_) != address(0), "missing erc20");
        require(ERC20Decimals_ > 0, "ERC20Decimals missing");
        bnToken = IBnTokenERC20(address(bnToken_));
        ERC20Decimals = ERC20Decimals_;
        defaultThreshold = defaultThreshold_;
        StandardRewards = IStandardRewards(address(StandardRewards_));

        prevReferencePrice = refPerTok();
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function strictPrice() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        return chainlinkFeed.price(oracleTimeout).mul(refPerTok());
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
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
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        uint192 rate = uint192(bnToken.poolTokenToUnderlying(address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48),1e6));
        int8 shiftLeft = 8 - ERC20Decimals - 8;
        return shiftl_toFix(rate, shiftLeft);
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev delegatecall
    function claimRewards() external virtual override {
        uint192 programId = StandardRewards.latestProgramId(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);
        StandardRewards.claimRewards(programId);
    }
}
