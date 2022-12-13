// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../../libraries/Fixed.sol";
import "../assets/OracleLib.sol";
import "./AbstractDMVaultTokenCollateral.sol";

contract DMVaultTokenFiatCollateral is AbstractDMVaultTokenCollateral {
    using OracleLib for AggregatorV3Interface;

    constructor(
        address vault_,
        uint256 maxTradeVolume_,
        uint256 fallbackPrice_,
        bytes32 targetName_,
        uint256 delayUntilDefault_,
        uint256 ratePerPeriod_,
        AggregatorV3Interface chainlinkFeed_,
        uint48 oracleTimeout_,
        uint256 defaultThreshold_
    )
        AbstractDMVaultTokenCollateral(
            vault_,
            maxTradeVolume_,
            fallbackPrice_,
            targetName_,
            delayUntilDefault_,
            ratePerPeriod_,
            chainlinkFeed_,
            oracleTimeout_,
            defaultThreshold_
        )
    {} // solhint-disable-line no-empty-blocks

    function _checkAndUpdateDefaultStatus() internal override returns (bool isSound) {
        try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
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
