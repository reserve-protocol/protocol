// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

library MathHelpers {

    function max(uint256[] memory array) internal returns (uint256 index, uint256 value) {
        for (uint256 i = 0; i < array.length; i++) {
            if (array[i] > value) {
                value = array[i];
                index = i;
            }
        }
    }
}
