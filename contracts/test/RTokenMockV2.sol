
// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../RToken.sol";

contract RTokenMockV2 is  RToken {

     function getVersion() public pure returns(string memory) {
         return "V2";
     }
}