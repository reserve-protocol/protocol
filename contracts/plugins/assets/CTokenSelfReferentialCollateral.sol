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

    int8 public referenceERC20Decimals;
    uint192 public prevReferencePrice; // previous rate, {collateral/reference}
    IERC20 public override rewardERC20;
    address public comptrollerAddr;

    constructor(
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        bytes32 targetName_,
        int8 referenceERC20Decimals_,
        IERC20 rewardERC20_,
        address comptrollerAddr_
    ) Collateral(chainlinkFeed_, erc20_, maxTradeVolume_, targetName_) {
        referenceERC20Decimals = referenceERC20Decimals_;
        rewardERC20 = rewardERC20_;
        prevReferencePrice = refPerTok(); // {collateral/reference}
        comptrollerAddr = comptrollerAddr_;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        return chainlinkFeed.price().mul(refPerTok());
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
        if (referencePrice.lt(prevReferencePrice)) {
            whenDefault = block.timestamp;
        } else {
            try chainlinkFeed.price_() returns (uint192) {
                priceable = true;
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
    function status() public view override returns (CollateralStatus) {
        if (whenDefault == NEVER) {
            return CollateralStatus.SOUND;
        } else if (whenDefault <= block.timestamp) {
            return CollateralStatus.DISABLED;
        } else {
            return CollateralStatus.IFFY;
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
        return chainlinkFeed.price();
    }

    /// Get the message needed to call in order to claim rewards for holding this asset.
    /// @return _to The address to send the call to
    /// @return _cd The calldata to send
    function getClaimCalldata() external view override returns (address _to, bytes memory _cd) {
        _to = comptrollerAddr;
        _cd = abi.encodeWithSignature("claimComp(address)", msg.sender);
    }
}
