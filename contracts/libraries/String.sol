// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

// From https://gist.github.com/ottodevs/c43d0a8b4b891ac2da675f825b1d1dbf
library StringLib {
    /// Convert all uppercase letters in str to lowercase
    /// @dev This turns out to work for UTF-8 in general. We won't lowercase
    /// capital letters outside of 7-bit ASCII, but we won't change any multi-byte
    /// codepoints either.
    function toLower(string memory str) internal pure returns (string memory) {
        bytes memory bStr = bytes(str);
        bytes memory bLower = new bytes(bStr.length);
        for (uint256 i = 0; i < bStr.length; i++) {
            // Uppercase character...
            if ((uint8(bStr[i]) >= 65) && (uint8(bStr[i]) <= 90)) {
                // So we add 32 to make it lowercase
                bLower[i] = bytes1(uint8(bStr[i]) + 32);
            } else {
                bLower[i] = bStr[i];
            }
        }
        return string(bLower);
    }
}
