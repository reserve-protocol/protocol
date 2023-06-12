// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

// From https://gist.github.com/ottodevs/c43d0a8b4b891ac2da675f825b1d1dbf
library StringLib {
    /// Convert any basic uppercase chars (A-Z) in str to lowercase
    /// @dev This is safe for general Unicode strings in UTF-8, because every byte representing a
    /// multibyte codepoint has its high bit set to 1, and this only modifies bytes with a high bit
    /// set to 0. As a result, this function will _not_ transform any multi-byte capital letters,
    /// like Ö, À, or Æ, to lowercase. That's much harder, and this is sufficient for our purposes.
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
