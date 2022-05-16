// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p1/StRSRVotes.sol";

contract StRSRP1VotesV2 is StRSRP1Votes {
    uint256 public newValue;

    function setNewValue(uint256 newValue_) external onlyOwner {
        newValue = newValue_;
    }

    function version() external pure returns (string memory) {
        return "V2";
    }
}
