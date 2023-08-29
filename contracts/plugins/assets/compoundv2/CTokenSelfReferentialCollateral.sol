// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../erc20/RewardableERC20Wrapper.sol";
import "../AppreciatingFiatCollateral.sol";
import "./ICToken.sol";

/**
 * @title CTokenSelfReferentialCollateral
 * @notice Collateral plugin for a cToken of unpegged collateral, such as cETH.
 * Expected: {tok} != {ref}, {ref} == {target}, {target} != {UoA}
 */
contract CTokenSelfReferentialCollateral is AppreciatingFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // All v2 cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.

    uint8 public immutable referenceERC20Decimals;

    ICToken public immutable cToken; // gas-optimization: access underlying cToken directly

    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    /// @param revenueHiding {1} A value like 1e-6 that represents the maximum refPerTok to hide
    /// @param referenceERC20Decimals_ The number of decimals in the reference token
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        uint8 referenceERC20Decimals_
    ) AppreciatingFiatCollateral(config, revenueHiding) {
        require(config.defaultThreshold == 0, "default threshold not supported");
        require(referenceERC20Decimals_ > 0, "referenceERC20Decimals missing");
        cToken = ICToken(address(RewardableERC20Wrapper(address(config.erc20)).underlying()));
        referenceERC20Decimals = referenceERC20Decimals_;
    }

    /// Can revert, used by other contract functions in order to catch errors
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
        uint192 p = chainlinkFeed.price(oracleTimeout).mul(_underlyingRefPerTok());
        uint192 err = p.mul(oracleError, CEIL);

        low = p - err;
        high = p + err;
        // assert(low <= high); obviously true just by inspection

        pegPrice = targetPerRef();
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() public virtual override {
        CollateralStatus oldStatus = status();

        // == Refresh ==
        // Update the Compound Protocol -- access cToken directly
        // solhint-disable no-empty-blocks
        try cToken.exchangeRateCurrent() {} catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            markStatus(CollateralStatus.DISABLED);
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }

        // Violation of calling super first! Composition broken! Intentional!
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
