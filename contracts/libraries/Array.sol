// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

library ArrayLib {
    /// O(n^2)
    /// @return If the array contains all unique addresses
    function allUnique(IERC20[] memory arr) internal pure returns (bool) {
        uint256 arrLen = arr.length;
        for (uint256 i = 1; i < arrLen; i++) {
            for (uint256 j = 0; j < i; j++) {
                if (arr[i] == arr[j]) return false;
            }
        }
        return true;
    }
}
