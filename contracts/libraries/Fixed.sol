// SPDX-License-Identifier: BlueOak-1.0.0
// solhint-disable func-name-mixedcase func-visibility
pragma solidity ^0.8.9;

/// @title FixedPoint, a fixed-point arithmetic library defining the custom type int192
/// @author Matt Elder <matt.elder@reserve.org> and the Reserve Team <https://reserve.org>

/** The logical type `int192` is a 192 bit value, representing an 18-decimal Fixed-point
    fractional value.  This is what's described in the Solidity documentation as
    "fixed192x18" -- a value represented by 192 bits, that makes 18 digits available to
    the right of the decimal point.

    The range of values that int192 can represent is about [-1.7e20, 1.7e20].
    Unless a function explicitly says otherwise, it will fail on overflow.
    To be clear, the following should hold:
    toFix(0) == 0
    toFix(1) == 1e18
*/

// An int value passed to this library was out of bounds for int192 operations
error IntOutOfBounds();
// A uint value passed to this library was out of bounds for int192 operations
error UIntOutOfBounds();

// If a particular int192 is represented by the int192 n, then the int192 represents the
// value n/FIX_SCALE.
int64 constant FIX_SCALE = 1e18;
uint64 constant FIX_SCALE_U = uint64(FIX_SCALE);

// FIX_SCALE Squared:
int128 constant FIX_SCALE_SQ = 1e36;
uint128 constant FIX_SCALE_SQ_U = uint128(FIX_SCALE_SQ);

// The largest integer that can be converted to int192.
// This is a bit bigger than 3.1e39
int192 constant FIX_MAX_INT = type(int192).max / FIX_SCALE;

// The smallest integer that can be converted to int192.
// This is a bit less than -3.1e39
int192 constant FIX_MIN_INT = type(int192).min / FIX_SCALE;

int192 constant FIX_ZERO = 0; // The int192 representation of zero.
int192 constant FIX_ONE = FIX_SCALE; // The int192 representation of one.
int192 constant FIX_MAX = type(int192).max; // The largest int192. (Not an integer!)
int192 constant FIX_MIN = type(int192).min; // The smallest int192.

/// An enum that describes a rounding approach for converting to ints
enum RoundingMode {
    FLOOR, // Round towards zero
    ROUND, // Round to the nearest int
    CEIL // Round away from zero
}

RoundingMode constant FLOOR = RoundingMode.FLOOR;
RoundingMode constant ROUND = RoundingMode.ROUND;
RoundingMode constant CEIL = RoundingMode.CEIL;

/* @dev Solidity 0.8.x only allows you to change one of type or size per type conversion.
   Thus, all the tedious-looking double conversions like uint256(uint192(foo))
   See: https://docs.soliditylang.org/en/v0.8.9/080-breaking-changes.html#new-restrictions
 */

/// Explicitly convert an int256 to an int192. Revert if the input is out of bounds.
function _safeWrap(int256 x) pure returns (int192) {
    if (x < int256(type(int192).min) || int256(type(int192).max) < x) revert IntOutOfBounds();
    return int192(x);
}

/// Explicitly convert a uint256 to an int192. Revert if the input is out of bounds.
function _safeWrapu(uint256 x) pure returns (int192) {
    if (x > uint256(uint192(type(int192).max))) revert UIntOutOfBounds();
    return int192(int256(x));
}

/// Convert a uint to its int192 representation. Fails if x is outside int192's representable range.
function toFix(uint256 x) pure returns (int192) {
    return _safeWrapu(x * FIX_SCALE_U);
}

/// Convert a uint to its fixed-point representation after left-shifting its value `shiftLeft`
/// decimal digits. Fails if the result is outside int192's representable range.
function shiftl_toFix(uint256 x, int8 shiftLeft) pure returns (int192) {
    return shiftl_toFix(x, shiftLeft, FLOOR);
}

function shiftl_toFix(
    uint256 x,
    int8 shiftLeft,
    RoundingMode rounding
) pure returns (int192) {
    shiftLeft += 18;

    if (x == 0 || shiftLeft < -77) return 0; // shift would clear a uint256; 0 -> 0
    if (77 < shiftLeft) revert IntOutOfBounds(); // would unconditionally overflow x

    uint256 coeff = 10**abs(shiftLeft);
    uint256 shifted = (shiftLeft >= 0) ? x * coeff : _divrnd(x, coeff, rounding);

    return _safeWrapu(shifted);
}

function id(int192 x) pure returns (int192) {
    return x;
}

/// Divide a uint by a int192. Fails if the result is outside int192's representable range
/// (May also fail if the result is MIN_INT192; not fixing this for optimization's sake.)
function divFix(uint256 x, int192 y) pure returns (int192) {
    // If we didn't have to worry about overflow, we'd just do `return x * 1e36 / _y`
    // If it's safe to do this operation the easy way, do it:
    if (x < uint256(type(int256).max / FIX_SCALE_SQ)) {
        return _safeWrap(int256(x * FIX_SCALE_SQ_U) / y);
    } else {
        return signOf(y) * _safeWrapu(mulDiv256(x, FIX_SCALE_SQ_U, abs(y)));
    }
}

/// Divide a uint by a uint, yielding a fix
function divuu(uint256 x, uint256 y) pure returns (int192) {
    return _safeWrapu(mulDiv256(FIX_SCALE_U, x, y));
}


function fixMin(int192 x, int192 y) pure returns (int192) {
    return x < y ? x : y;
}

function fixMax(int192 x, int192 y) pure returns (int192) {
    return x > y ? x : y;
}

function signOf(int256 x) pure returns (int8) {
    return x < 0 ? int8(-1) : int8(1);
}

function abs(int256 x) pure returns (uint256) {
    return uint256(x < 0 ? -x : x);
}

/// internal: Do an internal division with given rounding. Where numerator and divisor are int200s
/// (not presumed to be fixed-point values!), return numerator/divisor.
/// Round the division's result as specified by `rounding`.
function _divrnd(
    int256 numerator,
    int256 divisor,
    RoundingMode rounding
) pure returns (int256) {
    int256 result = numerator / divisor;
    if (rounding == FLOOR || numerator == 0) return result;

    if (rounding == CEIL) {
        if (numerator % divisor != 0) {
            result += signOf(numerator) * signOf(divisor);
        }
    } else {
        if (abs(numerator % divisor) > (abs(divisor) - 1) / 2) {
            result += signOf(numerator) * signOf(divisor);
        }
    }
    return result;
}

/// internal: Do an internal division with given rounding. Where numerator and divisor are uint200s
/// (not presumed to be fixed-point values!), return numerator/divisor.
/// Round the division's result as specified by `rounding`.
function _divrnd(
    uint256 numerator,
    uint256 divisor,
    RoundingMode rounding
) pure returns (uint256) {
    uint256 result = numerator / divisor;

    if (rounding == FLOOR) return result;

    if (rounding == ROUND) {
        if (numerator % divisor > (divisor - 1) / 2) {
            result++;
        }
    } else {
        if (numerator % divisor > 0) {
            result++;
        }
    }

    return result;
}

library FixLib {
    /// All arithmetic functions fail if and only if the result is out of bounds.

    /// Convert this fixed-point value to a uint; round the result towards zero
    function toUint(int192 x) internal pure returns (uint136) {
        return toUint(x, FLOOR);
    }

    /// Convert this int192 to a uint, applying the rounding approach described by the enum
    function toUint(int192 x, RoundingMode rounding) internal pure returns (uint136) {
        if (x < 0) revert IntOutOfBounds();
        return uint136(_divrnd(uint192(x), FIX_SCALE_U, rounding));
    }

    /// Return the int192 shifted to the left by `decimal` digits
    /// Similar to a bitshift but in base 10
    /// Equivalent to multiplying `x` by `10**decimal`
    function shiftl(int192 x, int8 decimals) internal pure returns (int192) {
        return shiftl(x, decimals, FLOOR);
    }

    /// Return the int192 shifted to the left by `decimal` digits
    /// (Similar to a bitshift but in base 10)
    /// Equivalent to multiplying `x` by `10**decimal`
    function shiftl(
        int192 x,
        int8 decimals,
        RoundingMode rounding
    ) internal pure returns (int192) {
        int256 coeff = int256(10**abs(decimals));
        return _safeWrap(decimals >= 0 ? x * coeff : _divrnd(x, coeff, rounding));
    }

    /// Add a int192 to this int192.
    function plus(int192 x, int192 y) internal pure returns (int192) {
        return x + y;
    }

    /// Add a uint to this int192.
    function plusu(int192 x, uint256 y) internal pure returns (int192) {
        if (y > type(uint256).max / 2) revert UIntOutOfBounds();
        return _safeWrap(x + int256(y) * FIX_SCALE);
    }

    /// Subtract a int192 from this int192.
    function minus(int192 x, int192 y) internal pure returns (int192) {
        return x - y;
    }

    /// Subtract a uint from this int192.
    function minusu(int192 x, uint256 y) internal pure returns (int192) {
        if (y > type(uint256).max / 2) revert UIntOutOfBounds();
        return _safeWrap(int256(x) - int256(y * FIX_SCALE_U));
    }

    /// Multiply this int192 by a int192.
    /// Round truncated values to the nearest available value. 5e-19 rounds away from zero.
    function mul(int192 x, int192 y) internal pure returns (int192) {
        return mul(x, y, ROUND);
    }

    function mul(
        int192 x,
        int192 y,
        RoundingMode rounding
    ) internal pure returns (int192) {
        return _safeWrap(_divrnd(int256(x) * int256(y), FIX_SCALE, rounding));
    }

    /// Multiply this int192 by a uint.
    function mulu(int192 x, uint256 y) internal pure returns (int192) {
        if (y > type(uint256).max / 2) revert UIntOutOfBounds();
        return _safeWrap(x * int256(y));
    }

    /// Divide this int192 by a int192; round the fractional part towards zero.
    function div(int192 x, int192 y) internal pure returns (int192) {
        return div(x, y, FLOOR);
    }

    function div(
        int192 x,
        int192 y,
        RoundingMode rounding
    ) internal pure returns (int192) {
        // Multiply-in FIX_SCALE before dividing by y to preserve precision.
        int256 shiftedX = int256(x) * FIX_SCALE;
        return _safeWrap(_divrnd(shiftedX, y, rounding));
    }

    /// Divide this int192 by a uint.
    function divu(int192 x, uint256 y) internal pure returns (int192) {
        return divu(x, y, FLOOR);
    }

    function divu(
        int192 x,
        uint256 y,
        RoundingMode rounding
    ) internal pure returns (int192) {
        if (y > uint256(type(int256).max)) return FIX_ZERO;
        return _safeWrap(_divrnd(x, int256(y), rounding));
    }

    uint64 constant FIX_HALF = uint64(FIX_SCALE) / 2;

    /// Raise this int192 to a nonnegative integer power.
    /// Presumes that powu(0.0, 0) = 1
    /// @dev The gas cost is O(lg(y)). We can maybe do better but it will get very fiddly indeed.
    /// Rounding: intermediate muls do nearest-value rounding. Anything else gets wierd quick.
    function powu(int192 x_, uint32 y) internal pure returns (int192) {
        // The algorithm is exponentiation by squaring. See: https://w.wiki/4LjE
        if (y == 1) return x_;
        if (x_ == FIX_ONE || y == 0) return FIX_ONE;
        bool isNegative = (x_ < 0 && y & 1 == 1);
        uint256 x = x_ < 0 ? uint192(-x_) : uint192(x_);

        uint256 result = FIX_SCALE_U;
        while (true) {
            if (y & 1 == 1) result = (result * x + FIX_HALF) / FIX_SCALE_U;
            if (y <= 1) break;
            y = y >> 1;
            x = (x * x + FIX_HALF) / FIX_SCALE_U;
        }
        return isNegative ? -_safeWrapu(result) : _safeWrapu(result);
    }

    /// Comparison operators...
    function lt(int192 x, int192 y) internal pure returns (bool) {
        return x < y;
    }

    function lte(int192 x, int192 y) internal pure returns (bool) {
        return x <= y;
    }

    function gt(int192 x, int192 y) internal pure returns (bool) {
        return x > y;
    }

    function gte(int192 x, int192 y) internal pure returns (bool) {
        return x >= y;
    }

    function eq(int192 x, int192 y) internal pure returns (bool) {
        return x == y;
    }

    function neq(int192 x, int192 y) internal pure returns (bool) {
        return x != y;
    }

    /// Return whether or not this int192 is less than epsilon away from y.
    function near(
        int192 x_,
        int192 y_,
        int192 epsilon
    ) internal pure returns (bool) {
        int256 x = x_;
        int256 y = y_;
        int256 diff = x - y;
        return -epsilon < diff && diff < epsilon;
    }

    // ================ Chained Operations ================
    // The operation foo_bar() always means:
    //   Do foo() followed by bar(), and overflow only if the _end_ result doesn't fit in an int192

    function shiftl_toUint(int192 x, int8 decimals) internal pure returns (uint256) {
        return shiftl_toUint(x, decimals, FLOOR);
    }

    /// Shift this int192, left by `decimals`, and then convert the result to a uint.
    /// Do all this applying the given rounding mode.
    /// Overflow only if the end result doesn't fit in an int192.
    function shiftl_toUint(
        int192 x,
        int8 decimals,
        RoundingMode rounding
    ) internal pure returns (uint256) {
        if (x < 0) revert IntOutOfBounds();
        decimals -= 18; // shift so that toUint happens at the same time.
        int256 coeff = int256(10**abs(decimals));
        return decimals >= 0 ? uint256(x * coeff) : uint256(_divrnd(x, coeff, rounding));
    }

    /// Multiply this int192 by a uint and output the result as a uint, rounding towards zero.
    function mulu_toUint(int192 x, uint256 y) internal pure returns (uint256) {
        // special-cased because it's easy and probably cheaper
        if (x < 0) revert IntOutOfBounds();
        return mulDiv256(uint192(x), y, FIX_SCALE_U);
    }

    /// Multiply this int192 by a uint and output the result as a uint, rounding as specified.
    function mulu_toUint(
        int192 x,
        uint256 y,
        RoundingMode rounding
    ) internal pure returns (uint256) {
        // This underlying operation is:
        // raw_x * raw_y / FIX_SCALE, with the division respecting `rounding`
        if (x < 0) revert IntOutOfBounds();
        return mulDiv256(uint192(x), y, FIX_SCALE_U, rounding);
    }

    /// Multiply this int192 by a int192 and output the result as a uint, rounding towards zero.
    function mul_toUint(int192 x, int192 y) internal pure returns (uint256) {
        // underlyingly, this is raw_x * raw_y / FIX_SCALE_SQ
        if ((x < 0) != (y < 0)) revert IntOutOfBounds();
        if (x < 0) {
            x = -x;
            y = -y;
        }
        return mulDiv256(uint192(x), uint192(y), FIX_SCALE_SQ_U);
    }

    /// Multiply this int192 by a int192 and output the result as a uint, rounding towards zero.
    function mul_toUint(
        int192 x,
        int192 y,
        RoundingMode rounding
    ) internal pure returns (uint256) {
        // Fundamentally, this is raw_x * raw_y / FIX_SCALE_SQ
        if ((x < 0) != (y < 0)) revert IntOutOfBounds();
        if (x < 0) {
            x = -x;
            y = -y;
        }
        return mulDiv256(uint192(x), uint192(y), FIX_SCALE_SQ_U, rounding);
    }

    /// A chained .mul + .div on uints that avoids intermediate overflow
    /// @dev Do not use if you don't need it; has higher gas costs than x * y / z
    function muluDivu(
        int192 x,
        uint256 y,
        uint256 z
    ) internal pure returns (int192) {
        return muluDivu(x, y, z, FLOOR);
    }

    /// A chained .mul + .div on uints that avoids intermediate overflow
    /// @dev Do not use if you don't need it; has higher gas costs than x * y / z
    function muluDivu(
        int192 x,
        uint256 y,
        uint256 z,
        RoundingMode rounding
    ) internal pure returns (int192) {
        // bug: if abs(x) * y is in [2^255, 2^256),
        return int192(signOf(x)) * _safeWrapu(mulDiv256(abs(x), y, z, rounding));
    }

    /// A chained .mul + .div on Fixes that avoids intermediate overflow
    /// @dev Do not use if you don't need it; has higher gas costs than x * y / z
    function mulDiv(
        int192 x,
        int192 y,
        int192 z
    ) internal pure returns (int192) {
        return mulDiv(x, y, z, FLOOR);
    }

    /// A chained .mul + .div on Fixes that avoids intermediate overflow
    /// @dev Do not use if you don't need it; has higher gas costs than x * y / z
    function mulDiv(
        int192 x,
        int192 y,
        int192 z,
        RoundingMode rounding
    ) internal pure returns (int192) {
        int192 sign = ((x < 0) != (y < 0) != (z < 0)) ? int192(-1) : int192(1);
        // i.e, sign == signOf(x) * signOf(y) * signOf(z)
        // i.e, sign is -1 iff ((x<0) xor (y<0) xor (z<0)) is true
        // i.e, sign is -1 iff an odd number of (x<0), (y<0), (z<0) are true

        return sign * _safeWrapu(mulDiv256(abs(x), abs(y), abs(z), rounding));
    }
}

// ================ a couple pure-uint helpers================

/// mulDiv: return (x*y/z), overflowing *only* if the end result is out of range.
///   Adapted from sources:
///   https://medium.com/coinmonks/4db014e080b1, https://medium.com/wicketh/afa55870a65
///   and quite a few of the other excellent "Mathemagic" posts from https://medium.com/wicketh
/// @dev Just use x*y/z unless you need to avoid intermediate overflow. This has higher gas costs
function mulDiv256(
    uint256 x,
    uint256 y,
    uint256 z
) pure returns (uint256 result) {
    unchecked {
        (uint256 lo, uint256 hi) = fullMul(x, y);
        if (hi >= z) revert UIntOutOfBounds();
        uint256 mm = mulmod(x, y, z);
        if (mm > lo) hi -= 1;
        lo -= mm;
        uint256 pow2 = z & (0 - z);
        z /= pow2;
        lo /= pow2;
        lo += hi * ((0 - pow2) / pow2 + 1);
        uint256 r = 1;
        r *= 2 - z * r;
        r *= 2 - z * r;
        r *= 2 - z * r;
        r *= 2 - z * r;
        r *= 2 - z * r;
        r *= 2 - z * r;
        r *= 2 - z * r;
        r *= 2 - z * r;
        result = lo * r;
    }
}

/// return (x*y/z), overflowing only if the end result is out of range, and having the division
/// round as specified by `rounding`.
function mulDiv256(
    uint256 x,
    uint256 y,
    uint256 z,
    RoundingMode rounding
) pure returns (uint256) {
    uint256 result = mulDiv256(x, y, z);
    if (rounding == FLOOR) return result;

    uint256 mm = mulmod(x, y, z);
    if (rounding == CEIL) {
        if (mm > 0) result += 1;
    } else {
        if (mm > ((z - 1) / 2)) result += 1; // z should be z-1
    }
    return result;
}

/// fullMul: return (x*y) as a "virtual uint512"
/// The computed result is (hi*2^256 + lo)
///   Adapted from sources:
///   https://medium.com/wicketh/27650fec525d, https://medium.com/coinmonks/4db014e080b1
/// @dev Intended to be internal to this library
function fullMul(uint256 x, uint256 y) pure returns (uint256 lo, uint256 hi) {
    unchecked {
        uint256 mm = mulmod(x, y, uint256(0) - uint256(1));
        lo = x * y;
        hi = mm - lo;
        if (mm < lo) hi -= 1;
    }
}
