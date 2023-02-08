// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "../interfaces/IVersioned.sol";

/**
 * @title Versioned
 * @notice A mix-in to track semantic versioning uniformly across contracts.
 */
abstract contract Versioned is IVersioned {
    function version() public pure virtual override returns (string memory) {
        return "2.0.0";
    }
}
