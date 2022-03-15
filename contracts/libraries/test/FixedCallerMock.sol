// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.9;

import "../Fixed.sol" as FixGlobals;
import { FixLib, RoundingApproach } from "../Fixed.sol";

// Simple mock for Fixed library.
contract FixedCallerMock {
    function toFix(uint256 x) public pure returns (int192) {
        return FixGlobals.toFix(x);
    }

    function toFixWithShift(uint256 x, int8 shiftLeft_) public pure returns (int192) {
        return FixGlobals.toFixWithShift(x, shiftLeft_);
    }

    function intToFix(int256 x) public pure returns (int192) {
        return FixGlobals.intToFix(x);
    }

    function divFix(uint256 x, int192 y) public pure returns (int192) {
        return FixGlobals.divFix(x, y);
    }

    function fixMin(int192 x, int192 y) public pure returns (int192) {
        return FixGlobals.fixMin(x, y);
    }

    function fixMax(int192 x, int192 y) public pure returns (int192) {
        return FixGlobals.fixMax(x, y);
    }

    function toInt(int192 x) public pure returns (int192) {
        return FixLib.toInt(x);
    }

    function toUint(int192 x, RoundingApproach rounding) public pure returns (uint192) {
        return FixLib.toUint(x, rounding);
    }

    function floor(int192 x) public pure returns (uint192) {
        return FixLib.floor(x);
    }

    function round(int192 x) public pure returns (uint192) {
        return FixLib.round(x);
    }

    function ceil(int192 x) public pure returns (uint192) {
        return FixLib.ceil(x);
    }

    function shiftLeft(int192 x, int8 shiftLeft_) public pure returns (int192) {
        return FixLib.shiftLeft(x, shiftLeft_);
    }

    function intRound(int192 x) public pure returns (int192) {
        return FixLib.intRound(x);
    }

    function plus(int192 x, int192 y) public pure returns (int192) {
        return FixLib.plus(x, y);
    }

    function plusu(int192 x, uint256 y) public pure returns (int192) {
        return FixLib.plusu(x, y);
    }

    function minus(int192 x, int192 y) public pure returns (int192) {
        return FixLib.minus(x, y);
    }

    function minusu(int192 x, uint256 y) public pure returns (int192) {
        return FixLib.minusu(x, y);
    }

    function mul(int192 x, int192 y) public pure returns (int192) {
        return FixLib.mul(x, y);
    }

    function mulu(int192 x, uint256 y) public pure returns (int192) {
        return FixLib.mulu(x, y);
    }

    function div(int192 x, int192 y) public pure returns (int192) {
        return FixLib.div(x, y);
    }

    function divu(int192 x, uint256 y) public pure returns (int192) {
        return FixLib.divu(x, y);
    }

    function divuRound(int192 x, uint256 y) public pure returns (int192) {
        return FixLib.divuRound(x, y);
    }

    function inv(int192 x) public pure returns (int192) {
        return FixLib.inv(x);
    }

    function powu(int192 x, uint256 y) public pure returns (int192) {
        return FixLib.powu(x, y);
    }

    function increment(int192 x) public pure returns (int192) {
        return FixLib.increment(x);
    }

    function lt(int192 x, int192 y) public pure returns (bool) {
        return FixLib.lt(x, y);
    }

    function lte(int192 x, int192 y) public pure returns (bool) {
        return FixLib.lte(x, y);
    }

    function gt(int192 x, int192 y) public pure returns (bool) {
        return FixLib.gt(x, y);
    }

    function gte(int192 x, int192 y) public pure returns (bool) {
        return FixLib.gte(x, y);
    }

    function eq(int192 x, int192 y) public pure returns (bool) {
        return FixLib.eq(x, y);
    }

    function neq(int192 x, int192 y) public pure returns (bool) {
        return FixLib.neq(x, y);
    }

    /// Return whether or not this int192 is within epsilon of y.
    function near(
        int192 x,
        int192 y,
        int192 epsilon
    ) public pure returns (bool) {
        return FixLib.near(x, y, epsilon);
    }

    // Nonview version for gas estimation in test framework
    function powu_nonview(int192 x, uint256 y) public pure {
        FixLib.powu(x, y);
    }
}
