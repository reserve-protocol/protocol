// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "./vendor/CometCore.sol";

contract CometExtMock is CometCore {
    function setBaseSupplyIndex(uint64 newIndex) external {
        baseSupplyIndex = newIndex;
    }
}
