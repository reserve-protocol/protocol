// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/Address.sol";
import "../../libraries/Fixed.sol";
import "./ERC20Mock.sol";

/// Represents a simple smart contract wallet that provides approvals via ERC1271
/// https://eips.ethereum.org/EIPS/eip-1271
contract ERC1271Mock {
    // bytes4(keccak256("isValidSignature(bytes32,bytes)")
    bytes4 internal constant MAGICVALUE = 0x1626ba7e;

    bool public approvalsOn = false;

    function enableApprovals() external {
        approvalsOn = true;
    }

    function disableApprovals() external {
        approvalsOn = false;
    }

    /**
     * @dev Should return whether the signature provided is valid for the provided hash
     *
     * MUST return the bytes4 magic value 0x1626ba7e when function passes.
     * MUST NOT modify state (using STATICCALL for solc < 0.5, view modifier for solc > 0.5)
     * MUST allow external calls
     */
    function isValidSignature(bytes32, bytes memory) public view returns (bytes4 magicValue) {
        return approvalsOn ? MAGICVALUE : bytes4(0);
    }
}
