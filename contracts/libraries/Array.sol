// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

library ArrayLib {
    /// O(n^2)
    /// @return If the array contains all unique addresses
    function allUnique(IERC20[] memory arr) internal pure returns (bool) {
        uint256 arrLen = arr.length;
        for (uint256 i = 1; i < arrLen; ++i) {
            for (uint256 j = 0; j < i; ++j) {
                if (arr[i] == arr[j]) return false;
            }
        }
        return true;
    }

    /// O(n) -- must already be in sorted ascending order!
    /// @return If the array contains all unique addresses, in ascending order
    function sortedAndAllUnique(IERC20[] memory arr) internal pure returns (bool) {
        uint256 arrLen = arr.length;
        for (uint256 i = 1; i < arrLen; ++i) {
            if (uint160(address(arr[i])) <= uint160(address(arr[i - 1]))) return false;
        }
        return true;
    }
}
