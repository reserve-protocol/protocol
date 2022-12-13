// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./AbstractRHVaultTokenCollateral.sol";
import "../assets/OracleLib.sol";
import "../../libraries/Fixed.sol";

contract RHVaultTokenNonFiatCollateral is AbstractRHVaultTokenCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    AggregatorV3Interface public immutable underlyingTargetToRefFeed;

    constructor(
        address vault_,
        uint256 maxTradeVolume_,
        uint256 fallbackPrice_,
        bytes32 targetName_,
        uint256 delayUntilDefault_,
        uint16 basisPoints_,
        AggregatorV3Interface underlyingTargetToUoAFeed_,
        AggregatorV3Interface underlyingTargetToRefFeed_,
        uint48 oracleTimeout_,
        uint256 defaultThreshold_
    )
        AbstractRHVaultTokenCollateral(
            vault_,
            maxTradeVolume_,
            fallbackPrice_,
            targetName_,
            delayUntilDefault_,
            basisPoints_,
            underlyingTargetToUoAFeed_,
            oracleTimeout_,
            defaultThreshold_
        )
    {
        underlyingTargetToRefFeed = underlyingTargetToRefFeed_;
    }

    /// Can return 0, can revert
    /// @return {UoA/tok} The current price()
    function strictPrice() public view virtual override returns (uint192) {
        return
            chainlinkFeed
                .price(oracleTimeout)
                .mul(underlyingTargetToRefFeed.price(oracleTimeout))
                .mul(actualRefPerTok());
    }

    function _checkAndUpdateDefaultStatus() internal override returns (bool isSound) {
        // Doesn't need to check if peg is defaulting since they're not pegged anyways
        try underlyingTargetToRefFeed.price_(oracleTimeout) returns (uint192 p) {
            // If the price is below the default-threshold price, default eventually
            // uint192(+/-) is the same as Fix.plus/minus
            if (p < FIX_ONE - defaultThreshold || p > FIX_ONE + defaultThreshold)
                markStatus(CollateralStatus.IFFY);
            else {
                markStatus(CollateralStatus.SOUND);
                isSound = true;
            }
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            markStatus(CollateralStatus.IFFY);
        }
    }
}
