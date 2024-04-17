// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v4.9.5) (utils/Multicall.sol)

pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @dev Forked from OpenZeppelin v4.9.6, removes gap
 *
 */
abstract contract Multicall is Initializable, ContextUpgradeable {
    /**
     * @dev Receives and executes a batch of function calls on this contract.
     * @custom:oz-upgrades-unsafe-allow-reachable delegatecall
     */
    function multicall(bytes[] calldata data) external virtual returns (bytes[] memory results) {
        bytes memory context = msg.sender == _msgSender()
            ? new bytes(0)
            : msg.data[msg.data.length - _contextSuffixLength():];

        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            results[i] = AddressUpgradeable.functionDelegateCall(
                address(this),
                bytes.concat(data[i], context)
            );
        }
        return results;
    }
}
