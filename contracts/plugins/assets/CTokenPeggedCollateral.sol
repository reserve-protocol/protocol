// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/abstract/CompoundOracleMixin.sol";
import "contracts/plugins/assets/CTokenFiatCollateral.sol";

/**
 * @title CTokenPeggedCollateral
 * @notice Collateral plugin for a cToken of a pegged asset. For example:
 *   - cWBTC
 *   - ...
 */
contract CTokenPeggedCollateral is CompoundOracleMixin, Collateral {
    using FixLib for uint192;
    using SafeERC20 for IERC20Metadata;

    // All cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}
    IERC20 public override rewardERC20;

    string public oracleLookupSymbol;

    constructor(
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IERC20Metadata referenceERC20_,
        IComptroller comptroller_,
        IERC20 rewardERC20_,
        string memory targetName_
    )
        Collateral(
            erc20_,
            maxTradeVolume_,
            defaultThreshold_,
            delayUntilDefault_,
            referenceERC20_,
            bytes32(bytes(targetName_))
        )
        CompoundOracleMixin(comptroller_)
    {
        rewardERC20 = rewardERC20_;
        prevReferencePrice = refPerTok(); // {collateral/reference}
        oracleLookupSymbol = targetName_;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual returns (uint192) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        return consultOracle(oracleLookupSymbol).mul(refPerTok());
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
        } else {
            // Check for soft default of underlying reference token
            uint192 p = consultOracle(referenceERC20.symbol());

            // D18{UoA/ref} = D18{UoA/target} * D18{target/ref} / D18
            uint192 peg = (pricePerTarget() * targetPerRef()) / FIX_ONE;
            uint192 delta = (peg * defaultThreshold) / FIX_ONE; // D18{UoA/ref}

            // If the price is below the default-threshold price, default eventually
            if (p < peg - delta || p > peg + delta) {
                whenDefault = Math.min(block.timestamp + delayUntilDefault, whenDefault);
            } else whenDefault = NEVER;
        }
        prevReferencePrice = referencePrice;

        if (whenDefault != oldWhenDefault) {
            emit DefaultStatusChanged(oldWhenDefault, whenDefault, status());
        }
        // No interactions beyond the initial refresher
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        uint256 rate = ICToken(address(erc20)).exchangeRateStored();
        int8 shiftLeft = 8 - int8(referenceERC20.decimals()) - 18;
        return shiftl_toFix(rate, shiftLeft);
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return consultOracle(oracleLookupSymbol);
    }

    /// Get the message needed to call in order to claim rewards for holding this asset.
    /// @return _to The address to send the call to
    /// @return _cd The calldata to send
    function getClaimCalldata() external view override returns (address _to, bytes memory _cd) {
        _to = address(comptroller);
        _cd = abi.encodeWithSignature("claimComp(address)", msg.sender);
    }
}
