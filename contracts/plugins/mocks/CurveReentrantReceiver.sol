// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../interfaces/IAsset.sol";

contract CurveReentrantReceiver {
    ICollateral curvePlugin;

    constructor(ICollateral curvePlugin_) {
        curvePlugin = curvePlugin_;
        curvePlugin.refresh(); // should not revert yet
    }

    fallback() external payable {
        // should revert if re-entrant
        try curvePlugin.refresh() {} catch {
            revert("refresh() reverted");
        }
    }
}
