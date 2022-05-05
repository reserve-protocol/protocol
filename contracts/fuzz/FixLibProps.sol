// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";

contract FixProps {
    using FixLib for int192;

    int192 public base = FIX_ONE;
    uint32 public a = 1;
    uint32 public b = 1;

    function setBase(int192 base_) external {
        base = base_ % 1e18;
    }

    function setA(uint32 a_) external {
        a = a_;
    }

    function setB(uint32 b_) external {
        b = b_;
    }

    event Values(int192, int192);

    int192 public constant EPS = 2;

    function echidna_powu_additive_law() external returns (bool) {
        int192 val1 = base.powu(a).mul(base.powu(b));
        int192 val2 = base.powu(a + b);
        emit Values(val1, val2);
        return val1.near(val2, EPS);
    }

    function echidna_powu_multiplicative_law() external returns (bool) {
        int192 val1 = base.powu(a).powu(b);
        int192 val2 = base.powu(a * b);
        emit Values(val1, val2);
        return val1.near(val2, EPS);
    }
}
