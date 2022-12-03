// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./ICToken.sol";
import "./SelfReferentialCollateral.sol";

/**
 * @title CTokenSelfReferentialCollateral
 * @notice Collateral plugin for a cToken of unpegged collateral, such as cETH.
 * Expected: {tok} != {ref}, {ref} == {target}, {target} != {UoA}
 */
contract CTokenSelfReferentialCollateral is SelfReferentialCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // All cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.

    uint8 public immutable referenceERC20Decimals;

    IComptroller public immutable comptroller;

    /// @param referenceERC20Decimals_ The number of decimals in the reference token
    /// @param comptroller_ The CompoundFinance Comptroller
    constructor(
        CollateralConfig memory config,
        uint8 referenceERC20Decimals_,
        IComptroller comptroller_
    ) SelfReferentialCollateral(config) {
        require(referenceERC20Decimals_ > 0, "referenceERC20Decimals missing");
        require(address(comptroller_) != address(0), "comptroller missing");
        referenceERC20Decimals = referenceERC20Decimals_;
        comptroller = comptroller_;
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() public virtual override {
        // == Refresh ==
        // Update the Compound Protocol
        ICToken(address(erc20)).exchangeRateCurrent();

        // Violation of calling super first! Composition broken! Intentional!
        super.refresh(); // already handles all necessary default checks
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        uint256 rate = ICToken(address(erc20)).exchangeRateStored();
        int8 shiftLeft = 8 - int8(referenceERC20Decimals) - 18;
        return shiftl_toFix(rate, shiftLeft);
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev delegatecall
    function claimRewards() external virtual override {
        IERC20 comp = IERC20(comptroller.getCompAddress());
        uint256 oldBal = comp.balanceOf(address(this));
        comptroller.claimComp(address(this));
        emit RewardsClaimed(comp, comp.balanceOf(address(this)) - oldBal);
    }
}
