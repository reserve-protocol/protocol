// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "../../../interfaces/IRewardable.sol";
import "../erc20/RewardableERC20Wrapper.sol";
import "./ICToken.sol";

/**
 * @title CTokenFiatCollateral
 * @notice Collateral plugin for a cToken of fiat collateral, like cUSDC or cUSDP
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 * Also used for FluxFinance
 */
contract CTokenFiatCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // All v2 cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.

    uint8 public immutable referenceERC20Decimals;

    ICToken public immutable cToken; // gas-optimization: access underlying cToken directly

    /// @param config.erc20 Should be a CTokenWrapper
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {
        cToken = ICToken(address(RewardableERC20Wrapper(address(config.erc20)).underlying()));
        referenceERC20Decimals = IERC20Metadata(cToken.underlying()).decimals();
        require(referenceERC20Decimals > 0, "referenceERC20Decimals missing");
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() public virtual override {
        CollateralStatus oldStatus = status();

        // == Refresh ==
        // Update the Compound Protocol
        // solhint-disable no-empty-blocks
        try cToken.exchangeRateCurrent() {} catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            markStatus(CollateralStatus.DISABLED);

            CollateralStatus newStatus = status();
            if (oldStatus != newStatus) {
                emit CollateralStatusChanged(oldStatus, newStatus);
            }
        }

        // Intentional and correct for the super call to be last!
        super.refresh(); // already handles all necessary default checks
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        uint256 rate = cToken.exchangeRateStored();
        int8 shiftLeft = 8 - int8(referenceERC20Decimals) - 18;
        return shiftl_toFix(rate, shiftLeft);
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// DEPRECATED: claimRewards() will be removed from all assets and collateral plugins
    function claimRewards() external virtual override(Asset, IRewardable) {
        IRewardable(address(erc20)).claimRewards();
    }
}
