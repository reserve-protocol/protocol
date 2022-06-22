// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "./SelfReferentialCollateral.sol";

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
contract CTokenSelfReferentialCollateral is SelfReferentialCollateral {
    using FixLib for uint192;

    // Default Status:
    // whenDefault == NEVER: no risk of default (initial value)
    // whenDefault > block.timestamp: delayed default may occur as soon as block.timestamp.
    //                In this case, the asset may recover, reachiving whenDefault == NEVER.
    // whenDefault <= block.timestamp: default has already happened (permanently)
    uint256 internal constant NEVER = type(uint256).max;
    uint256 public whenDefault = NEVER;

    // All cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.

    IERC20Metadata public immutable referenceERC20;
    uint192 public prevReferencePrice; // previous rate, {collateral/reference}
    IERC20 public immutable override rewardERC20;
    bytes32 public immutable oracleLookupKey;
    address public immutable comptrollerAddr;

    constructor(
        IMain main_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        IERC20Metadata referenceERC20_,
        IERC20 rewardERC20_,
        bytes32 targetName_,
        address comptrollerAddr_
    ) SelfReferentialCollateral(main_, erc20_, maxTradeVolume_, targetName_) {
        referenceERC20 = referenceERC20_;
        rewardERC20 = rewardERC20_;
        prevReferencePrice = refPerTok(); // {collateral/reference}
        oracleLookupKey = targetName_;
        comptrollerAddr = comptrollerAddr_;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        return main.oracle().priceUSD(oracleLookupKey).mul(refPerTok());
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        // == Refresh ==
        // Update the Compound Protocol
        ICToken(address(erc20)).exchangeRateCurrent();

        if (whenDefault <= block.timestamp) return;
        uint256 oldWhenDefault = whenDefault;

        // Check for hard default
        uint192 referencePrice = refPerTok();
        if (referencePrice.lt(prevReferencePrice)) {
            whenDefault = block.timestamp;
            emit DefaultStatusChanged(oldWhenDefault, whenDefault, status());
        }
        prevReferencePrice = referencePrice;

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
        int8 shiftLeft = 8 - int8(referenceERC20.decimals()) - 18;
        return shiftl_toFix(rate, shiftLeft);
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return main.oracle().priceUSD(oracleLookupKey);
    }

    /// Get the message needed to call in order to claim rewards for holding this asset.
    /// @return _to The address to send the call to
    /// @return _cd The calldata to send
    function getClaimCalldata() external view override returns (address _to, bytes memory _cd) {
        _to = comptrollerAddr;
        _cd = abi.encodeWithSignature("claimComp(address)", msg.sender);
    }
}
