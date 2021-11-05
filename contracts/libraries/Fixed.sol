// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.9;

/// @title FixedPoint, a fixed-point arithmetic library defining the custom type Fix
/// @author Matt Elder <matt.elder@reserve.org> and the Reserve Team <https://reserve.org>

/** The type `Fix` is a 128 bit value, representing an 18-decimal Fixed-point
    fractional value.  This is what's described in the Solidity documentation as
    "fixed128x18" -- a value represented by 128 bits, that makes 18 digits available to
    the right of the decimal point.
    The range of values that Fix can represent is about [-1.7e20, 1.7e20].
    Unless a function explicitly says otherwise, it will fail on overflow.
    To be clear, the following should hold:
    Fixed.ofInt(0) == Fix.wrap(0)
    Fixed.ofInt(1) == Fix.wrap(1e18)
    Fixed.ofInt(-1) == Fix.wrap(-1e18)
*/

// An int value passed to this library was out of bounds for Fix operations
error IntOutOfBounds(int256 value);
// A uint value passed to this library was out of bounds for Fix operations
error UIntOutOfBounds(uint256 value);

// The central type this library provides. You'll declare values of this type.
type Fix is int128;

// If a particular Fix is represented by the int128 n, then the Fix represents the
// value n/FIX_SCALE.
int128 constant FIX_SCALE = int128(uint128(1e18));

// The largest integer that can be converted to Fix.
// This is about 1.7e20
int128 constant FIX_MAX_INT = type(int128).max / FIX_SCALE;

// The smallest integer that can be converted to Fix.
// This is about -1.7e20
int128 constant FIX_MIN_INT = type(int128).min / FIX_SCALE;

Fix constant FIX_ZERO = Fix.wrap(0); // The Fix representation of zero.
Fix constant FIX_ONE = Fix.wrap(FIX_SCALE); // The Fix representation of one.
Fix constant FIX_MAX = Fix.wrap(type(int128).max); // The largest Fix. (Not an integer!)
Fix constant FIX_MIN = Fix.wrap(type(int128).min); // The smallest Fix.

/* @dev To understand the tedious-looking double conversions (e.g, uint256(uint128(foo))) herein:
   Solidity 0.8.x only allows you to type-convert _one_ of type or size per conversion.
   See: https://docs.soliditylang.org/en/v0.8.9/080-breaking-changes.html#new-restrictions
 */

/// Explicitly convert int256 x to an int128; but revert if x is out of bounds.
function safe_int128(int256 x) pure returns (int128) {
    if (x < type(int128).min || type(int128).max < x) {
        revert IntOutOfBounds(x);
    }
    return int128(x);
}

/// Convert a uint to its Fix representation. Fails if x is outside Fix's representable range.
function toFix(uint256 x) pure returns (Fix) {
    if (uint256(uint128(FIX_MAX_INT)) < x) {
        revert UIntOutOfBounds(x);
    }
    int128 x_ = int128(uint128(x));
    return Fix.wrap(x_ * FIX_SCALE);
}

/// Convert a uint to its Fix representation after shifting its value `shiftLeft` digits.
/// Fails if the shifted value is outside Fix's representable range.
function toFix(uint256 x, int256 shiftLeft) pure returns (Fix) {
    shiftLeft += 18;
    uint256 shifted = (shiftLeft >= 0) ? x * 10**uint256(shiftLeft) : x / 10**(uint256(-shiftLeft));

    if (uint256(uint128(FIX_MAX_INT * FIX_SCALE)) < shifted) {
        revert UIntOutOfBounds(shifted);
    }
    int128 x_ = int128(uint128(shifted));
    return Fix.wrap(x_);
}

/// Convert an int to its Fix representation. Fails if x is outside Fix's representable range.
function intToFix(int256 x) pure returns (Fix) {
    return Fix.wrap(safe_int128(x * FIX_SCALE));
}

/// Divide a uint by a Fix. Fails if the result is outside Fix's representable range.

/** @dev This is about this simplest way to do this. It also Just Works in all cases where the
 * result fits in Fix, which may be surprising. See docs/fixlib-reasoning.md in this repo for the
 * worked logic by which this case is correct, and also the principles by which you can reason that
 * all these other functions are similarly correct.
 */
function divFix(uint256 x, Fix y) pure returns (Fix) {
    int128 _y = Fix.unwrap(y);
    return Fix.wrap(safe_int128(int256(x * uint128(FIX_SCALE * FIX_SCALE)) / int256(_y)));
}

function fixMin(Fix x, Fix y) pure returns (Fix) {
    return FixLib.lt(x, y) ? x : y;
}

function fixMax(Fix x, Fix y) pure returns (Fix) {
    return FixLib.gt(x, y) ? x : y;
}

library FixLib {
    /// All arithmetic functions fail if and only if the result is out of bounds.

    /// Convert this Fix to an int. Round the fractional part towards zero.
    function toInt(Fix x) internal pure returns (int128) {
        return Fix.unwrap(x) / FIX_SCALE;
    }
    /// Convert this Fix to a uint. Fail if x is negative. Round the fractional part towards zero.
    function toUint(Fix x) internal pure returns (uint128) {
        int128 n = Fix.unwrap(x);
        if (n < 0) {
            revert IntOutOfBounds(n);
        }
        return uint128(n) / uint128(FIX_SCALE);
    }

    /// Round this Fix to the nearest int. If equidistant to both
    /// adjacent ints, round up, away from zero.
    function round(Fix x) internal pure returns (int128) {
        int128 x_ = Fix.unwrap(x);
        int128 rounding_adjustment = x_ >= 0 ? FIX_SCALE/2 : -FIX_SCALE/2;
        return (x_ + rounding_adjustment) / FIX_SCALE;
    }

    /// Add a Fix to this Fix.
    function plus(Fix x, Fix y) internal pure returns (Fix) {
        return Fix.wrap(Fix.unwrap(x) + Fix.unwrap(y));
    }

    /// Add an int to this Fix.
    function plusi(Fix x, int256 y) internal pure returns (Fix) {
        int256 result = Fix.unwrap(x) + y * FIX_SCALE;
        return Fix.wrap(safe_int128(result));
    }

    /// Add a uint to this Fix.
    function plusu(Fix x, uint256 y) internal pure returns (Fix) {
        if (y > type(uint256).max / 2) {
            revert UIntOutOfBounds(y);
        }
        return plusi(x, int256(y));
    }

    /// Subtract a Fix from this Fix.
    function minus(Fix x, Fix y) internal pure returns (Fix) {
        return Fix.wrap(Fix.unwrap(x) - Fix.unwrap(y));
    }

    /// Subtract an int from this Fix.
    function minusi(Fix x, int256 y) internal pure returns (Fix) {
        return Fix.wrap(safe_int128(Fix.unwrap(x) - y * FIX_SCALE));
    }

    /// Subtract a uint from this Fix.
    function minusu(Fix x, uint256 y) internal pure returns (Fix) {
        if (y > type(uint256).max / 2) {
            revert UIntOutOfBounds(y);
        }
        return minusi(x, int256(y));
    }

    /// Multiply this Fix by a Fix.
    /// Round truncated values to the nearest available value. 5e-19 rounds away from zero.
    function mul(Fix x, Fix y) internal pure returns (Fix) {
        int256 naive_prod = int256(Fix.unwrap(x)) * int256(Fix.unwrap(y));
        int256 rounding_adjustment = ((naive_prod >= 0 ? int8(1) : int8(-1)) * FIX_SCALE) / 2;
        return Fix.wrap(safe_int128((naive_prod + rounding_adjustment) / FIX_SCALE));
    }

    /// Multiply this Fix by an int.
    function muli(Fix x, int256 y) internal pure returns (Fix) {
        return Fix.wrap(safe_int128(Fix.unwrap(x) * y));
    }

    /// Multiply this Fix by a uint.
    function mulu(Fix x, uint256 y) internal pure returns (Fix) {
        if (y > type(uint256).max / 2) {
            revert UIntOutOfBounds(y);
        }
        return muli(x, int256(y));
    }

    /// Divide this Fix by a Fix; round the fractional part towards zero.
    function div(Fix x, Fix y) internal pure returns (Fix) {
        // Multiply-in FIX_SCALE before dividing by y to preserve right-hand digits of result.
        int256 shift_x = int256(Fix.unwrap(x)) * FIX_SCALE;
        return Fix.wrap(safe_int128(shift_x / Fix.unwrap(y)));
    }

    /// Divide this Fix by an int.
    function divi(Fix x, int256 y) internal pure returns (Fix) {
        return Fix.wrap(safe_int128(Fix.unwrap(x) / y));
    }

    /// Divide this Fix by a uint.
    function divu(Fix x, uint256 y) internal pure returns (Fix) {
        if (y > type(uint256).max / 2) {
            return FIX_ZERO;
        }
        return divi(x, int256(y));
    }

    /// Compute 1 / (this Fix).
    function inv(Fix x) internal pure returns (Fix) {
        return div(FIX_ONE,(x));
    }

    /// Raise this Fix to a nonnegative integer power.
    /// Presumes that powu(0.0, 0) = 1
    /// @dev The gas cost is O(lg(y)). We can maybe do better but it will get very fiddly indeed.
    function powu(Fix x, uint256 y) internal pure returns (Fix) {
        // The algorithm is exponentiation by squaring. See: https://w.wiki/4LjE
        Fix result = FIX_ONE;
        while(true) {
            if (y & 1 == 1) result = mul(result, x);
            if (y <= 1) return result;
            y = y >> 1;
            x = mul(x, x);
        }
    }

    /// Comparison operators...
    function lt(Fix x, Fix y) internal pure returns (bool) {
        return Fix.unwrap(x) < Fix.unwrap(y);
    }

    function lte(Fix x, Fix y) internal pure returns (bool) {
        return Fix.unwrap(x) <= Fix.unwrap(y);
    }

    function gt(Fix x, Fix y) internal pure returns (bool) {
        return Fix.unwrap(x) > Fix.unwrap(y);
    }

    function gte(Fix x, Fix y) internal pure returns (bool) {
        return Fix.unwrap(x) >= Fix.unwrap(y);
    }

    function eq(Fix x, Fix y) internal pure returns (bool) {
        return Fix.unwrap(x) == Fix.unwrap(y);
    }

    function neq(Fix x, Fix y) internal pure returns (bool) {
        return Fix.unwrap(x) != Fix.unwrap(y);
    }

    /// Return whether or not this Fix is less than epsilon away from y.
    function near(
        Fix x,
        Fix y,
        Fix epsilon
    ) internal pure returns (bool) {
        int256 x_ = Fix.unwrap(x);
        int256 y_ = Fix.unwrap(y);

        int256 diff = (x_ <= y_) ? (y_ - x_) : (x_ - y_);
        return diff < Fix.unwrap(epsilon);
    }
}
