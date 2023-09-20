// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../../p1/Main.sol";

contract MainP1V2 is MainP1 {
    uint256 public newValue;

    function setNewValue(uint256 newValue_) external {
        require(!tradingPausedOrFrozen(), "frozen or trading paused");
        newValue = newValue_;
    }

    function version() public pure override(Versioned, IVersioned) returns (string memory) {
        return "2.0.0";
    }
}
