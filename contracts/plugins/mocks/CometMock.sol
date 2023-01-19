// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.9;

contract CometMock {
    int256 internal _reserves;
    uint256 internal _targetReserves;

    constructor(uint256 targetReserves_, int256 reserves_) {
        _targetReserves = targetReserves_;
        _reserves = reserves_;
    }

    function setReserves(int256 amount) external {
        _reserves = amount;
    }

    function setTargetReserves(uint256 amount) external {
        _targetReserves = amount;
    }

    function targetReserves() external view returns (uint256) {
        return _targetReserves;
    }

    function getReserves() public view returns (int256) {
        return _reserves;
    }
}
