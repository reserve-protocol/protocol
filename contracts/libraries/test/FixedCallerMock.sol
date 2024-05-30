// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.19;

import "../Fixed.sol";

// Simple mock for Fixed library.
contract FixedCallerMock {
    function toFix_(uint256 x) public pure returns (uint192) {
        return toFix(x);
    }

    function shiftl_toFix_(uint256 x, int8 d) public pure returns (uint192) {
        return shiftl_toFix(x, d);
    }

    function shiftl_toFix_Rnd(
        uint256 x,
        int8 d,
        RoundingMode rnd
    ) public pure returns (uint192) {
        return shiftl_toFix(x, d, rnd);
    }

    function divFix_(uint256 x, uint192 y) public pure returns (uint192) {
        return divFix(x, y);
    }

    function divuu_(uint256 x, uint256 y) public pure returns (uint256) {
        return divuu(x, y);
    }

    function fixMin_(uint192 x, uint192 y) public pure returns (uint192) {
        return fixMin(x, y);
    }

    function fixMax_(uint192 x, uint192 y) public pure returns (uint192) {
        return fixMax(x, y);
    }

    function abs_(int256 x) public pure returns (uint256) {
        return abs(x);
    }

    function divrnd_(
        uint256 n,
        uint256 d,
        RoundingMode rnd
    ) public pure returns (uint256) {
        return _divrnd(n, d, rnd);
    }

    function toUint(uint192 x) public pure returns (uint256) {
        return FixLib.toUint(x);
    }

    function toUintRnd(uint192 x, RoundingMode rnd) public pure returns (uint256) {
        return FixLib.toUint(x, rnd);
    }

    function shiftl(uint192 x, int8 decimals) public pure returns (uint192) {
        return FixLib.shiftl(x, decimals);
    }

    function shiftlRnd(
        uint192 x,
        int8 decimals,
        RoundingMode rnd
    ) public pure returns (uint192) {
        return FixLib.shiftl(x, decimals, rnd);
    }

    function plus(uint192 x, uint192 y) public pure returns (uint192) {
        return FixLib.plus(x, y);
    }

    function plusu(uint192 x, uint256 y) public pure returns (uint192) {
        return FixLib.plusu(x, y);
    }

    function minus(uint192 x, uint192 y) public pure returns (uint192) {
        return FixLib.minus(x, y);
    }

    function minusu(uint192 x, uint256 y) public pure returns (uint192) {
        return FixLib.minusu(x, y);
    }

    function mul(uint192 x, uint192 y) public pure returns (uint192) {
        return FixLib.mul(x, y);
    }

    function mulRnd(
        uint192 x,
        uint192 y,
        RoundingMode rnd
    ) public pure returns (uint192) {
        return FixLib.mul(x, y, rnd);
    }

    function mulu(uint192 x, uint256 y) public pure returns (uint192) {
        return FixLib.mulu(x, y);
    }

    function div(uint192 x, uint192 y) public pure returns (uint192) {
        return FixLib.div(x, y);
    }

    function divRnd(
        uint192 x,
        uint192 y,
        RoundingMode rnd
    ) public pure returns (uint192) {
        return FixLib.div(x, y, rnd);
    }

    function divu(uint192 x, uint256 y) public pure returns (uint192) {
        return FixLib.divu(x, y);
    }

    function divuRnd(
        uint192 x,
        uint256 y,
        RoundingMode rnd
    ) public pure returns (uint192) {
        return FixLib.divu(x, y, rnd);
    }

    function powu(uint192 x, uint48 y) public pure returns (uint192) {
        return FixLib.powu(x, y);
    }

    function sqrt(uint192 x) public pure returns (uint192) {
        return FixLib.sqrt(x);
    }

    function lt(uint192 x, uint192 y) public pure returns (bool) {
        return FixLib.lt(x, y);
    }

    function lte(uint192 x, uint192 y) public pure returns (bool) {
        return FixLib.lte(x, y);
    }

    function gt(uint192 x, uint192 y) public pure returns (bool) {
        return FixLib.gt(x, y);
    }

    function gte(uint192 x, uint192 y) public pure returns (bool) {
        return FixLib.gte(x, y);
    }

    function eq(uint192 x, uint192 y) public pure returns (bool) {
        return FixLib.eq(x, y);
    }

    function neq(uint192 x, uint192 y) public pure returns (bool) {
        return FixLib.neq(x, y);
    }

    function near(
        uint192 x,
        uint192 y,
        uint192 epsilon
    ) public pure returns (bool) {
        return FixLib.near(x, y, epsilon);
    }

    // ================ chained operations
    function shiftl_toUint(uint192 x, int8 d) public pure returns (uint256) {
        return FixLib.shiftl_toUint(x, d);
    }

    function shiftl_toUintRnd(
        uint192 x,
        int8 d,
        RoundingMode rnd
    ) public pure returns (uint256) {
        return FixLib.shiftl_toUint(x, d, rnd);
    }

    function mulu_toUint(uint192 x, uint256 y) public pure returns (uint256) {
        return FixLib.mulu_toUint(x, y);
    }

    function mulu_toUintRnd(
        uint192 x,
        uint256 y,
        RoundingMode rnd
    ) public pure returns (uint256) {
        return FixLib.mulu_toUint(x, y, rnd);
    }

    function mul_toUint(uint192 x, uint192 y) public pure returns (uint256) {
        return FixLib.mul_toUint(x, y);
    }

    function mul_toUintRnd(
        uint192 x,
        uint192 y,
        RoundingMode rnd
    ) public pure returns (uint256) {
        return FixLib.mul_toUint(x, y, rnd);
    }

    function muluDivu(
        uint192 x,
        uint256 y,
        uint256 z
    ) public pure returns (uint192) {
        return FixLib.muluDivu(x, y, z);
    }

    function muluDivuRnd(
        uint192 x,
        uint256 y,
        uint256 z,
        RoundingMode rnd
    ) public pure returns (uint192) {
        return FixLib.muluDivu(x, y, z, rnd);
    }

    function mulDiv(
        uint192 x,
        uint192 y,
        uint192 z
    ) public pure returns (uint192) {
        return FixLib.mulDiv(x, y, z);
    }

    function mulDivRnd(
        uint192 x,
        uint192 y,
        uint192 z,
        RoundingMode rnd
    ) public pure returns (uint192) {
        return FixLib.mulDiv(x, y, z, rnd);
    }

    // ============== safe* operations
    function safeMul(
        uint192 a,
        uint192 b,
        RoundingMode rnd
    ) public pure returns (uint192) {
        return FixLib.safeMul(a, b, rnd);
    }

    function safeDiv_(
        uint192 a,
        uint192 b,
        RoundingMode rnd
    ) public pure returns (uint192) {
        return FixLib.safeDiv(a, b, rnd);
    }

    function safeDiv(
        uint192 x,
        uint192 y,
        RoundingMode rnd
    ) public pure returns (uint192) {
        return FixLib.safeDiv(x, y, rnd);
    }

    function safeMulDiv(
        uint192 x,
        uint192 y,
        uint192 z,
        RoundingMode rnd
    ) public pure returns (uint192) {
        return FixLib.safeMulDiv(x, y, z, rnd);
    }

    // ================ wide muldiv operations
    function mulDiv256_(
        uint256 x,
        uint256 y,
        uint256 z
    ) public pure returns (uint256) {
        return mulDiv256(x, y, z);
    }

    function mulDiv256Rnd_(
        uint256 x,
        uint256 y,
        uint256 z,
        RoundingMode rnd
    ) public pure returns (uint256) {
        return mulDiv256(x, y, z, rnd);
    }

    function fullMul_(uint256 x, uint256 y) public pure returns (uint256 h, uint256 l) {
        return fullMul(x, y);
    }
}
