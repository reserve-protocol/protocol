// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/AbstractCollateral.sol";

// ==== External Interfaces ====
// See: https://github.com/compound-finance/compound-protocol/blob/master/contracts/CToken.sol
interface ICToken {
    /// @dev From Compound Docs:
    /// The current (up to date) exchange rate, scaled by 10^(18 - 8 + Underlying Token Decimals).
    function exchangeRateCurrent() external returns (uint256);

    /// @dev From Compound Docs: The stored exchange rate, with 18 - 8 + UnderlyingAsset.Decimals.
    function exchangeRateStored() external view returns (uint256);
}

/**
 * @title CTokenSelfReferentialCollateral
 * @notice Collateral plugin for a cToken of a self-referential asset. For example:
 *   - cETH
 *   - cRSR
 *   - ...
 */
contract CTokenSelfReferentialCollateral is Collateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    // Default Status:
    // whenDefault == NEVER: no risk of default (initial value)
    // whenDefault > block.timestamp: delayed default may occur as soon as block.timestamp.
    //                In this case, the asset may recover, reachiving whenDefault == NEVER.
    // whenDefault <= block.timestamp: default has already happened (permanently)
    uint256 internal constant NEVER = type(uint256).max;
    uint256 public whenDefault = NEVER;

    // All cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.

    int8 public immutable referenceERC20Decimals;
    uint192 public prevReferencePrice; // previous rate, {collateral/reference}
    address public immutable comptrollerAddr;

    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param tradingRange_ {tok} The min and max of the trading range for this asset
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    constructor(
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        IERC20Metadata rewardERC20_,
        TradingRange memory tradingRange_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        int8 referenceERC20Decimals_,
        address comptrollerAddr_
    ) Collateral(chainlinkFeed_, erc20_, rewardERC20_, tradingRange_, oracleTimeout_, targetName_) {
        require(referenceERC20Decimals_ > 0, "referenceERC20Decimals missing");
        require(address(rewardERC20_) != address(0), "rewardERC20 missing");
        require(address(comptrollerAddr_) != address(0), "comptrollerAddr missing");
        referenceERC20Decimals = referenceERC20Decimals_;
        prevReferencePrice = refPerTok();
        comptrollerAddr = comptrollerAddr_;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        return chainlinkFeed.price(oracleTimeout).mul(refPerTok());
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        // == Refresh ==
        // Update the Compound Protocol
        ICToken(address(erc20)).exchangeRateCurrent();

        if (whenDefault <= block.timestamp) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (referencePrice < prevReferencePrice) {
            whenDefault = block.timestamp;
        } else {
            try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
                priceable = p > 0;
            } catch {
                priceable = false;
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
        // No interactions beyond the initial refresher
    }

    /// @return The collateral's status
    function status() public view virtual override returns (CollateralStatus) {
        if (whenDefault == NEVER) {
            return priceable ? CollateralStatus.SOUND : CollateralStatus.UNPRICED;
        } else {
            return CollateralStatus.DISABLED;
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        uint256 rate = ICToken(address(erc20)).exchangeRateStored();
        int8 shiftLeft = 8 - referenceERC20Decimals - 18;
        return shiftl_toFix(rate, shiftLeft);
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return chainlinkFeed.price(oracleTimeout);
    }

    /// @return min {tok} The minimium trade size
    function minTradeSize() external view virtual override returns (uint192 min) {
        try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
            // p = p.mul(refPerTok());
            p = uint192((uint256(p) * refPerTok()) / FIX_ONE_256);

            // {tok} = {UoA} / {UoA/tok}
            // return tradingRange.minVal.div(p, CEIL);
            uint256 min256 = (FIX_ONE_256 * tradingRange.minVal + p - 1) / p;
            if (type(uint192).max < min256) revert UIntOutOfBounds();
            min = uint192(min256);
        } catch {}
        if (min < tradingRange.minAmt) min = tradingRange.minAmt;
        if (min > tradingRange.maxAmt) min = tradingRange.maxAmt;
    }

    /// @return max {tok} The maximum trade size
    function maxTradeSize() external view virtual override returns (uint192 max) {
        try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
            // p = p.mul(refPerTok());
            p = uint192((uint256(p) * refPerTok()) / FIX_ONE_256);

            // {tok} = {UoA} / {UoA/tok}
            // return tradingRange.maxVal.div(p);
            uint256 max256 = (FIX_ONE_256 * tradingRange.maxVal) / p;
            if (type(uint192).max < max256) revert UIntOutOfBounds();
            max = uint192(max256);
        } catch {}
        if (max == 0 || max > tradingRange.maxAmt) max = tradingRange.maxAmt;
        if (max < tradingRange.minAmt) max = tradingRange.minAmt;
    }

    /// Get the message needed to call in order to claim rewards for holding this asset.
    /// @return _to The address to send the call to
    /// @return _cd The calldata to send
    function getClaimCalldata() external view override returns (address _to, bytes memory _cd) {
        _to = comptrollerAddr;
        _cd = abi.encodeWithSignature("claimComp(address)", msg.sender);
    }
}
