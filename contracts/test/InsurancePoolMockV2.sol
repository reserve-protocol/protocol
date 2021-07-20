// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./InsurancePoolMock.sol";

contract InsurancePoolMockV2 is InsurancePoolMock {
    function getVersion() public pure returns (string memory) {
        return "V2";
    }
}
