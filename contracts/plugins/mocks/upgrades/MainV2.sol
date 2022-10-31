// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p1/Main.sol";

contract MainP1V2 is MainP1 {
    uint256 public newValue;

    function setNewValue(uint256 newValue_) external {
        require(!pausedOrFrozen(), "paused or frozen");
        newValue = newValue_;
    }

    function version() public pure override returns (string memory) {
        return "2.0.0";
    }
}
