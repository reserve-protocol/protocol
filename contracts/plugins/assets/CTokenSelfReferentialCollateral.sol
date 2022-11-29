// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/ICToken.sol";

/**
 * @title CTokenSelfReferentialCollateral
 * @notice Collateral plugin for a cToken of a self-referential asset, like cETH or cRSR.
 * Expected: {tok} != {ref}, {ref} == {target}, {target} != {UoA}
 */
contract CTokenSelfReferentialCollateral is Collateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    // All cTokens have 8 decimals, but their underlying may have 18 or 6 or something else.

    uint8 public immutable referenceERC20Decimals;
    uint192 public prevReferencePrice; // previous rate, {ref/tok}
    IComptroller public immutable comptroller;

    /// @param fallbackPrice_ {UoA/tok} A fallback price to use for lot sizing when oracles fail
    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param oracleError_ {1} The % the oracle feed can be off by
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        uint192 oracleError_,
        ICToken erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint256 delayUntilDefault_,
        IComptroller comptroller_
    )
        Collateral(
            fallbackPrice_,
            chainlinkFeed_,
            oracleError_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(address(comptroller_) != address(0), "comptroller missing");
        referenceERC20Decimals = IERC20Metadata(erc20_.underlying()).decimals();
        prevReferencePrice = refPerTok();
        comptroller = comptroller_;
    }

    /// Should not revert
    /// @param low {UoA/tok} The low price estimate
    /// @param high {UoA/tok} The high price estimate
    /// @param chainlinkFeedPrice {UoA/ref}
    function _price()
        internal
        view
        override
        returns (uint192 low, uint192 high, uint192 chainlinkFeedPrice)
    {
        try chainlinkFeed.price_(oracleTimeout) returns (uint192 p1) {
            // {UoA/tok} = {UoA/ref} * {ref/tok}
            uint192 p = p1.mul(refPerTok());

            // oracleError is on whatever the _true_ price is, not the one observed
            low = p.div(FIX_ONE.plus(oracleError));
            high = p.div(FIX_ONE.minus(oracleError));
            chainlinkFeedPrice = p1;
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            high = FIX_MAX;
        }
    }

    /// Should not revert
    /// @return low {UoA/tok} The lower end of the price estimate
    /// @return high {UoA/tok} The upper end of the price estimate
    function price() public view virtual returns (uint192 low, uint192 high) {
        (low, high, ) = _price();
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        // == Refresh ==
        // Update the Compound Protocol
        ICToken(address(erc20)).exchangeRateCurrent();

        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            (uint192 low, , ) = _price();

            if (low == 0) markStatus(CollateralStatus.IFFY);
            else {
                _fallbackPrice = low;
                markStatus(CollateralStatus.SOUND);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
        // No interactions beyond the initial refresher
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
