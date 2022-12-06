// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

/// External Interface for gOHM
// https://etherscan.io/address/0x0ab87046fbb341d058f17cbc4c1133f25a20a52f
interface IgOHM {
    /**
     * @return {ref/tok} The price of ref per tok
     */
    function index() external view returns (uint256);
}
