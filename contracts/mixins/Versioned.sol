// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "../interfaces/IVersioned.sol";

// This value should be updated on each release
string constant VERSION = "2.1.0";

/**
 * @title Versioned
 * @notice A mix-in to track semantic versioning uniformly across contracts.
 */
abstract contract Versioned is IVersioned {
    function version() public pure virtual override returns (string memory) {
        return VERSION;
    }
}
