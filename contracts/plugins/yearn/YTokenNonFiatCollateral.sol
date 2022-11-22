// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./AbstractYTokenCollateral.sol";

contract YTokenNonFiatCollateral is AbstractYTokenCollateral {
    constructor(
        address vault_,
        uint256 maxTradeVolume_,
        uint256 fallbackPrice_,
        bytes32 targetName_,
        uint256 delayUntilDefault_,
        uint256 ratePerPeriod_,
        AggregatorV3Interface chainlinkFeed_,
        uint48 oracleTimeout_
    )
        AbstractYTokenCollateral(
            vault_,
            maxTradeVolume_,
            fallbackPrice_,
            targetName_,
            delayUntilDefault_,
            ratePerPeriod_,
            chainlinkFeed_,
            oracleTimeout_
        )
    {}

    function _checkAndUpdateDefaultStatus() internal override returns (bool isSound) {
        // Doesn't need to check if peg is defaulting since they're not pegged anyways
    }
}
