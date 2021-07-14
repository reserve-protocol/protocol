
// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./RTokenMock.sol";

contract RTokenMockV2 is RTokenMock {

     function getVersion() public pure returns(string memory) {
         return "V2";
     }
}