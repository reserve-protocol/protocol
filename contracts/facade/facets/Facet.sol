// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

/**
 * @title Facet
 * @notice An abstract Facet contract that should be extended by each individual Facet.
 */
// slither-disable-start
abstract contract Facet {
    modifier staticCall {
        require(msg.sender == address(0), "only callStatic");
        _;
    }
}
