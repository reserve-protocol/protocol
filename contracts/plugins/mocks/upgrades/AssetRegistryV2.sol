// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../../p1/AssetRegistry.sol";

contract AssetRegistryP1V2 is AssetRegistryP1 {
    uint256 public newValue;

    function setNewValue(uint256 newValue_) external governance {
        newValue = newValue_;
    }

    function version() public pure override(Versioned, IVersioned) returns (string memory) {
        return "2.0.0";
    }
}
