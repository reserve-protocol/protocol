// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../modules/InsurancePool.sol";

contract InsurancePoolMockV2 is InsurancePool {
    function getVersion() public pure returns (string memory) {
        return "V2";
    }
}
