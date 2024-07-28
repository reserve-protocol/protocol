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
 * Also used for FluxFinance. Should NOT use with an ERC20 wrapper.
 */
contract CTokenFiatCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // All v2 cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.

    uint8 public immutable referenceERC20Decimals;

    IComptroller private immutable comptroller;

    IERC20 private immutable comp; // COMP token

    /// @param config.erc20 The CToken itself
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {
        require(config.defaultThreshold != 0, "defaultThreshold zero");
        address referenceERC20 = ICToken(address(config.erc20)).underlying();
        referenceERC20Decimals = IERC20Metadata(referenceERC20).decimals();
        require(referenceERC20Decimals != 0, "referenceERC20Decimals missing");
        comptroller = ICToken(address(config.erc20)).comptroller();
        comp = IERC20(comptroller.getCompAddress());
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() public virtual override {
        // == Refresh ==
        // Update the Compound Protocol
        // solhint-disable no-empty-blocks
        try ICToken(address(erc20)).exchangeRateCurrent() {} catch (bytes memory errData) {
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
        uint256 rate = ICToken(address(erc20)).exchangeRateStored();
        int8 shiftLeft = 8 - int8(referenceERC20Decimals) - 18;
        return shiftl_toFix(rate, shiftLeft, FLOOR);
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @custom:delegate-call
    function claimRewards() external virtual override(Asset, IRewardable) {
        uint256 _bal = comp.balanceOf(address(this));
        address[] memory holders = new address[](1);
        address[] memory cTokens = new address[](1);
        holders[0] = address(this);
        cTokens[0] = address(erc20);
        comptroller.claimComp(holders, cTokens, false, true);
        emit RewardsClaimed(comp, comp.balanceOf(address(this)) - _bal);
    }
}
