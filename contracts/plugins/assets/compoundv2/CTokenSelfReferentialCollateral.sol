// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../erc20/RewardableERC20Wrapper.sol";
import "../AppreciatingFiatCollateral.sol";
import "./ICToken.sol";

/**
 * @title CTokenSelfReferentialCollateral
 * @notice Collateral plugin for a cToken of unpegged collateral, such as cETH.
 * Expected: {tok} != {ref}, {ref} == {target}, {target} != {UoA}
 * Should NOT use with an ERC20 wrapper.
 */
contract CTokenSelfReferentialCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // All v2 cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.

    uint8 public immutable referenceERC20Decimals;

    IComptroller private immutable comptroller;

    IERC20 private immutable comp; // COMP token

    /// @param config.erc20 The CToken itself
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    /// @param referenceERC20Decimals_ The number of decimals in the reference token
    ///                                Has to be passed in because cETH is missing `underlying()`
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        uint8 referenceERC20Decimals_
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        require(config.defaultThreshold == 0, "default threshold not supported");
        require(referenceERC20Decimals_ > 0, "referenceERC20Decimals missing");
        referenceERC20Decimals = referenceERC20Decimals_;
        comptroller = ICToken(address(config.erc20)).comptroller();
        comp = IERC20(comptroller.getCompAddress());
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should NOT be manipulable by MEV
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref}
    function tryPrice()
        external
        view
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 pegPrice
        )
    {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        uint192 p = chainlinkFeed.price(oracleTimeout).mul(underlyingRefPerTok());
        uint192 err = p.mul(oracleError, CEIL);

        low = p - err;
        high = p + err;
        // assert(low <= high); obviously true just by inspection

        pegPrice = targetPerRef();
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() public virtual override {
        // == Refresh ==
        // Update the Compound Protocol -- access cToken directly
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

        // Violation of calling super first! Composition broken! Intentional!
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
