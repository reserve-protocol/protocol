// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../assets/aave/ATokenFiatCollateral.sol";

contract MockableCollateral is ATokenFiatCollateral {
    using FixLib for uint192;

    uint192 private _targetPerRef;

    constructor(CollateralConfig memory config, uint192 revenueHiding)
        ATokenFiatCollateral(config, revenueHiding)
    {}

    function setTargetPerRef(uint192 val) external {
        _targetPerRef = val;
    }

    function targetPerRef() public view override returns (uint192) {
        return _targetPerRef;
    }
}
