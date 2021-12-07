// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.9;

import "../Fixed.sol" as FixGlobals;
import { Fix, FixLib } from "../Fixed.sol";

// Simple mock for Fixed library.
contract FixedCallerMock {
    function toFix(uint256 x) public pure returns (Fix) {
        return FixGlobals.toFix(x);
    }

    function toFixWithShift(uint256 x, int8 shiftLeft_) public pure returns (Fix) {
        return FixGlobals.toFixWithShift(x, shiftLeft_);
    }

    function intToFix(int256 x) public pure returns (Fix) {
        return FixGlobals.intToFix(x);
    }

    function divFix(uint256 x, Fix y) public pure returns (Fix) {
        return FixGlobals.divFix(x, y);
    }

    function fixMin(Fix x, Fix y) public pure returns (Fix) {
        return FixGlobals.fixMin(x, y);
    }

    function fixMax(Fix x, Fix y) public pure returns (Fix) {
        return FixGlobals.fixMax(x, y);
    }

    function toInt(Fix x) public pure returns (int192) {
        return FixLib.toInt(x);
    }

    function toUint(Fix x) public pure returns (uint192) {
        return FixLib.toUint(x);
    }

    function toRoundUint(Fix x) public pure returns (uint192) {
        return FixLib.toRoundUint(x);
    }

    function shiftLeft(Fix x, int8 shiftLeft_) public pure returns (Fix) {
        return FixLib.shiftLeft(x, shiftLeft_);
    }

    function round(Fix x) public pure returns (int192) {
        return FixLib.round(x);
    }

    function plus(Fix x, Fix y) public pure returns (Fix) {
        return FixLib.plus(x, y);
    }

    function plusi(Fix x, int256 y) public pure returns (Fix) {
        return FixLib.plusi(x, y);
    }

    function plusu(Fix x, uint256 y) public pure returns (Fix) {
        return FixLib.plusu(x, y);
    }

    function minus(Fix x, Fix y) public pure returns (Fix) {
        return FixLib.minus(x, y);
    }

    function minusi(Fix x, int256 y) public pure returns (Fix) {
        return FixLib.minusi(x, y);
    }

    function minusu(Fix x, uint256 y) public pure returns (Fix) {
        return FixLib.minusu(x, y);
    }

    function mul(Fix x, Fix y) public pure returns (Fix) {
        return FixLib.mul(x, y);
    }

    function muli(Fix x, int256 y) public pure returns (Fix) {
        return FixLib.muli(x, y);
    }

    function mulu(Fix x, uint256 y) public pure returns (Fix) {
        return FixLib.mulu(x, y);
    }

    function div(Fix x, Fix y) public pure returns (Fix) {
        return FixLib.div(x, y);
    }

    function divi(Fix x, int256 y) public pure returns (Fix) {
        return FixLib.divi(x, y);
    }

    function divu(Fix x, uint256 y) public pure returns (Fix) {
        return FixLib.divu(x, y);
    }

    function inv(Fix x) public pure returns (Fix) {
        return FixLib.inv(x);
    }

    function powu(Fix x, uint256 y) public pure returns (Fix) {
        return FixLib.powu(x, y);
    }

    function lt(Fix x, Fix y) public pure returns (bool) {
        return FixLib.lt(x, y);
    }

    function lte(Fix x, Fix y) public pure returns (bool) {
        return FixLib.lte(x, y);
    }

    function gt(Fix x, Fix y) public pure returns (bool) {
        return FixLib.gt(x, y);
    }

    function gte(Fix x, Fix y) public pure returns (bool) {
        return FixLib.gte(x, y);
    }

    function eq(Fix x, Fix y) public pure returns (bool) {
        return FixLib.eq(x, y);
    }

    function neq(Fix x, Fix y) public pure returns (bool) {
        return FixLib.neq(x, y);
    }

    /// Return whether or not this Fix is within epsilon of y.
    function near(
        Fix x,
        Fix y,
        Fix epsilon
    ) public pure returns (bool) {
        return FixLib.near(x, y, epsilon);
    }

    // Nonview version for gas estimation in test framework
    function powu_nonview(Fix x, uint256 y) public {
        FixLib.powu(x, y);
    }
}
