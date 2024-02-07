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
 * Also used for FluxFinance. Flexible enough to work with and without CTokenWrapper.
 */
contract CTokenFiatCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // All v2 cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.

    uint8 public immutable referenceERC20Decimals;

    ICToken public immutable cToken; // gas-optimization: access underlying cToken directly

    /// @param config.erc20 May be a CTokenWrapper or the cToken itself
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {
        require(config.defaultThreshold > 0, "defaultThreshold zero");

        ICToken _cToken = ICToken(address(config.erc20));
        address _underlying = _cToken.underlying();
        uint8 _referenceERC20Decimals;

        // _underlying might be a wrapper at this point, try to go one level further
        try ICToken(_underlying).underlying() returns (address _mostUnderlying) {
            _cToken = ICToken(_underlying);
            _referenceERC20Decimals = IERC20Metadata(_mostUnderlying).decimals();
        } catch {
            _referenceERC20Decimals = IERC20Metadata(_underlying).decimals();
        }

        cToken = _cToken;
        referenceERC20Decimals = _referenceERC20Decimals;
        require(referenceERC20Decimals > 0, "referenceERC20Decimals missing");
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() public virtual override {
        // == Refresh ==
        // Update the Compound Protocol
        // solhint-disable no-empty-blocks
        try cToken.exchangeRateCurrent() {} catch (bytes memory errData) {
            CollateralStatus oldStatus = status();

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
    function underlyingRefPerTok() public view override returns (uint192) {
        uint256 rate = cToken.exchangeRateStored();
        int8 shiftLeft = 8 - int8(referenceERC20Decimals) - 18;
        return shiftl_toFix(rate, shiftLeft);
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @custom:delegate-call
    function claimRewards() external virtual override(Asset, IRewardable) {
        // solhint-ignore-next-line no-empty-blocks
        try IRewardable(address(erc20)).claimRewards() {} catch {}
        // erc20 may not be a CTokenWrapper
    }
}
