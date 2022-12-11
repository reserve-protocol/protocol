// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "./ERC20Mock.sol";
import "contracts/libraries/Fixed.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/// GOhm Mock
/// @dev ERC20 + Index
/// @dev https://etherscan.io/address/0x0ab87046fbb341d058f17cbc4c1133f25a20a52f
contract GOHMMock is ERC20Mock {
    uint256 internal _index;

    constructor() ERC20Mock("Wrapped staked OHM", "gOHM") {
        _index = FIX_ONE;
    }

    /**
     * @notice Get amount of OHM for a one GOHM
     * @return _index {ref/tok}
     */
    function index() external view returns (uint256) {
        return _index;
    }

    /// @param index_ {ref/tok}
    function setIndex(uint256 index_) external {
        _index = index_;
    }
}
