// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.9;

import "../Fixed.sol";

// Simple mock for Fixed library.
// prettier-ignore
contract FixedCallerMock {
    function toFix_(uint256 x) public pure returns (int192) {
        return toFix(x);
    }
    function shiftl_toFix_(uint256 x, int8 d) public pure returns (int192) {
        return shiftl_toFix(x, d);
    }
    function shiftl_toFix_Rnd(uint256 x, int8 d, RoundingMode rnd) public pure returns (int192) {
        return shiftl_toFix(x, d, rnd);
    }
    function divFix_(uint256 x, int192 y) public pure returns (int192) {
        return divFix(x, y);
    }
    function fixMin_(int192 x, int192 y) public pure returns (int192) {
        return fixMin(x, y);
    }
    function fixMax_(int192 x, int192 y) public pure returns (int192) {
        return fixMax(x, y);
    }
    function signOf_(int256 x) public pure returns (int8) {
        return signOf(x);
    }
    function abs_(int256 x) public pure returns (uint256) {
        return abs(x);
    }
    function divrnd_(int256 n, int256 d, RoundingMode rnd) public pure returns (int256) {
        return _divrnd(n, d, rnd);
    }
    function divrnd_u(uint256 n, uint256 d, RoundingMode rnd) public pure returns (uint256) {
        return _divrnd(n, d, rnd);
    }
    function toUint(int192 x) public pure returns (uint192) {
        return FixLib.toUint(x);
    }
    function toUintRnd(int192 x, RoundingMode rnd) public pure returns (uint192) {
        return FixLib.toUint(x, rnd);
    }
    function shiftl(int192 x, int8 decimals) public pure returns (int192) {
        return FixLib.shiftl(x, decimals);
    }
    function shiftlRnd(int192 x, int8 decimals, RoundingMode rnd) public pure returns (int192) {
        return FixLib.shiftl(x, decimals, rnd);
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
    function mulRnd(int192 x, int192 y, RoundingMode rnd) public pure returns (int192) {
        return FixLib.mul(x, y, rnd);
    }
    function mulu(int192 x, uint256 y) public pure returns (int192) {
        return FixLib.mulu(x, y);
    }
    function div(int192 x, int192 y) public pure returns (int192) {
        return FixLib.div(x, y);
    }
    function divRnd(int192 x, int192 y, RoundingMode rnd) public pure returns (int192) {
        return FixLib.div(x, y, rnd);
    }
    function divu(int192 x, uint256 y) public pure returns (int192) {
        return FixLib.divu(x, y);
    }
    function divuRnd(int192 x, uint256 y, RoundingMode rnd) public pure returns (int192) {
        return FixLib.divu(x, y, rnd);
    }
    function powu(int192 x, uint256 y) public pure returns (int192) {
        return FixLib.powu(x, y);
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
    function near(int192 x, int192 y, int192 epsilon) public pure returns (bool) {
        return FixLib.near(x, y, epsilon);
    }

    // ================ chained operations
    function shiftl_toUint(int192 x, int8 d) public pure returns (uint256) {
        return FixLib.shiftl_toUint(x, d);
    }
    function shiftl_toUintRnd(int192 x, int8 d, RoundingMode rnd) public pure returns (uint256) {
        return FixLib.shiftl_toUint(x, d, rnd);
    }
    function mulu_toUint(int192 x, uint256 y) public pure returns (uint256) {
        return FixLib.mulu_toUint(x, y);
    }
    function mulu_toUintRnd(int192 x, uint256 y, RoundingMode rnd) public pure returns (uint256) {
        return FixLib.mulu_toUint(x, y, rnd);
    }
    function mul_toUint(int192 x, int192 y) public pure returns (uint256) {
        return FixLib.mul_toUint(x, y);
    }
    function mul_toUintRnd(int192 x, int192 y, RoundingMode rnd) public pure returns (uint256) {
        return FixLib.mul_toUint(x, y, rnd);
    }
    function muluDivu(int192 x, uint256 y, uint256 z) public pure returns (int192) {
        return FixLib.muluDivu(x, y, z);
    }
    function muluDivuRnd(int192 x, uint256 y, uint256 z, RoundingMode rnd) public pure returns (int192) {
        return FixLib.muluDivu(x, y, z, rnd);
    }
    function mulDiv(int192 x, int192 y, int192 z) public pure returns (int192) {
        return FixLib.mulDiv(x, y, z);
    }
    function mulDivRnd(int192 x, int192 y, int192 z, RoundingMode rnd) public pure returns (int192) {
        return FixLib.mulDiv(x, y, z, rnd);
    }

    // ================ wide muldiv operations
    function mulDiv256_(uint256 x, uint256 y, uint256 z) public pure returns (uint256) {
        return mulDiv256(x, y, z);
    }
    function mulDiv256Rnd_(uint256 x, uint256 y, uint256 z, RoundingMode rnd)
        public pure returns (uint256) {
        return mulDiv256(x, y, z, rnd);
    }
    function fullMul_(uint256 x, uint256 y) public pure returns (uint256 l, uint256 h) {
        return fullMul(x, y);
    }

    // ================ internal operations, for debugging
    function _divrndi(int256 n, int256 d, RoundingMode rounding) public pure returns (int256) {
        return _divrnd(n, d, rounding);
    }
    function _divrndu(uint256 n, uint256 d, RoundingMode rounding) public pure returns (uint256) {
        return _divrnd(n, d, rounding);
    }

}
