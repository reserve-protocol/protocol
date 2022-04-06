// SPDX-License-Identifier: BlueOak-1.0.0
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

/// An enum that describes a rounding approach for converting to Uints
enum RoundingApproach {
    FLOOR,
    ROUND,
    CEIL
}

/* @dev To understand the tedious-looking double conversions (e.g, uint256(uint192(foo))) herein:
   Solidity 0.8.x only allows you to type-convert _one_ of type or size per conversion.
   See: https://docs.soliditylang.org/en/v0.8.9/080-breaking-changes.html#new-restrictions
 */

/// Explicitly convert an int256 to an int192. Revert if the input is out of bounds.
function _safe_wrap(int256 x) pure returns (int192) {
    if (x < type(int192).min || type(int192).max < x) revert IntOutOfBounds();
    return int192(x);
}

/// Convert a uint to its int192 representation. Fails if x is outside int192's representable range.
function toFix(uint256 x) pure returns (int192) {
    if (uint192(FIX_MAX_INT) < x) revert UIntOutOfBounds();
    return int192(uint192(x)) * FIX_SCALE;
}

/// Convert a uint to its int192 representation after shifting its value `shiftLeft` digits.
/// Fails if the shifted value is outside int192's representable range.
function toFixWithShift(uint256 x, int8 shiftLeft) pure returns (int192) {
    if (x == 0 || shiftLeft < -95) return 0; // shift would clear a uint256; 0 -> 0
    if (59 < shiftLeft) revert IntOutOfBounds(); // would unconditionally overflow x

    shiftLeft += 18;
    uint256 shifted = (shiftLeft >= 0)
        ? x * 10**uint256(uint8(shiftLeft))
        : x / 10**(uint256(uint8(-shiftLeft)));

    if (uint192(type(int192).max) < shifted) revert UIntOutOfBounds();
    return int192(uint192(shifted));
}

/// Convert an int to its int192 representation. Fails if x is outside int192's representable range.
function intToFix(int256 x) pure returns (int192) {
    return _safe_wrap(x * FIX_SCALE);
}

/// Divide a uint by a int192. Fails if the result is outside int192's representable range.

/** @dev This is about this simplest way to do this. It also Just Works in all cases where the
 * result fits in int192, which may be surprising. See docs/fixlib-reasoning.md in this repo for the
 * worked logic by which this case is correct, and also the principles by which you can reason that
 * all these other functions are similarly correct.
 */

function divFix(uint256 x, int192 y) pure returns (int192) {
    int256 _y = int256(y);
    /* If we didn't have to worry about overflow or precision loss, we'd just do:
       return x * 1e36 / _y.
    */
    // If it's safe to do this operation the easy way, do it:
    if (x < uint256(type(int256).max / FIX_SCALE_SQ)) {
        return _safe_wrap(int256(x * FIX_SCALE_SQ_U) / _y);
    }
    /* If we're not in that safe range, there are still lots of situations where the output fits in
     * a int192, but (x * 1e36) does not fit in a uint256. For instance, x = 2**255; _y = 2**190. For
     * such cases, we've got to compute result = [x * 1e36 / _y] in a way that only leaves the bounds
     * of a uint256 if the result won't fit in a int192.

     * So, we'll do this, essentially, by long division. 1e18 is about 2**60, so 1e18 fits in 64 bits.
     */

    int256 sign = (_y < 0) ? int256(-1) : int256(1); // sign = sign(_y)
    uint256 div = uint256(_y * sign); // div = abs(_y),
    /* From starting conditions, we know that x in uint256, div in uint192, and 1e18 in uint64.

       We can't directly compute x * 1e18, because that might overflow a uint256. Instead,
       we'll... essentially do long division of x by _y, except that instead of "bringing" down a
       single zero per long divison step, we'll "bring down" 18 at a time.
    */

    // Each step overflows only if the result would overflow. Justifications follow:

    uint256 q0 = x / div; // x/div fits in uint256
    uint256 part0 = q0 * FIX_SCALE_SQ_U; // part0 <= result, so fits in int192 if result does
    uint256 r0 = x % div; // x%div < div fits in uint192, so r0 fits in uint192

    uint256 q1 = (r0 * FIX_SCALE_U) / div; // r0 in uint192 and 1e18 in uint64, so r0*1e18 in uint256
    uint256 part1 = q1 * FIX_SCALE_U; // part1 <= result, so fits in int192 if result does.
    uint256 r1 = (r0 * FIX_SCALE_U) % div; // r0 % div < div fits in uint192, so r1*1e18 fits in uint256

    uint256 q2 = (r1 * FIX_SCALE_U) / div; // q2 <= result so fits in int192 if result does

    return _safe_wrap(int256(part0 + part1 + q2) * sign);

    /* Let N == 1e18 (and N^2 == 1e36). Let's see that the above long-form division is correct:

       Claim: In arithmetic without overflow, q0*N^2 + q1*N + q2 = [x * 1e36 / div].

       Proof:
       (1)     x = q0*div + r0  with 0 <= r0 < div   (because q0 = [x/div] and r0 = x % div)
       (2)  r0*N = q1*div + r1  with 0 <= r1 < div   (because q1 = [r0/div] and r1 = r0 % div)
       (3)  r1*N = q2*div + r2  with 0 <= r2 < div   (because q2 = [r1/div], and let's say r2 = r1 % div)

       Multiply through (1) and (2) by factors of N as needed to get:
       (4)  x*N^2 = q0*N^2 * div + r0*N^2
       (5)  r0*N^2 = q1*N * div + r1*N

       Substitute away equal terms r0*N^2 and r1*N across (3,4,5) to get, and factor out the div, to get:
       (6)  x*N^2 = (q0*N^2 + q1*N + q2)*div + r2    with 0 <= r2 < div

       This means that (q0*N^2 + q1*N + q2) = [x*N^2/div], QED.
    */
}

function fixMin(int192 x, int192 y) pure returns (int192) {
    return FixLib.lt(x, y) ? x : y;
}

function fixMax(int192 x, int192 y) pure returns (int192) {
    return FixLib.gt(x, y) ? x : y;
}

library FixLib {
    /// All arithmetic functions fail if and only if the result is out of bounds.

    /// Convert this int192 to a uint. Fail if x is negative. Round the fractional part towards zero.
    function floor(int192 x) internal pure returns (uint192) {
        int192 n = x;
        if (n < 0) revert IntOutOfBounds();
        return uint192(n) / FIX_SCALE_U;
    }

    /// Convert this int192 to a uint with standard rounding to the nearest integer.
    function round(int192 x) internal pure returns (uint192) {
        int192 n = x;
        if (n < 0) revert IntOutOfBounds();
        return uint192(intRound(x));
    }

    /// Convert this int192 to a uint. Round the fractional part towards one.
    function ceil(int192 x) internal pure returns (uint192) {
        uint192 u = floor(x);
        if (uint192(x) == u * FIX_SCALE_U) return u;
        return u + 1;
    }

    /// Convert this int192 to a uint, applying the rounding approach described by the enum
    function toUint(int192 x, RoundingApproach rounding) internal pure returns (uint192) {
        if (rounding == RoundingApproach.ROUND) {
            return round(x);
        } else if (rounding == RoundingApproach.CEIL) {
            return ceil(x);
        }
        return floor(x);
    }

    /// Convert this int192 to an int. Round the fractional part towards zero.
    function toInt(int192 x) internal pure returns (int192) {
        return x / FIX_SCALE;
    }

    /// Return the int192 shifted to the left by `decimal` digits
    /// Similar to a bitshift but in base 10
    /// Equivalent to multiplying `x` by `10**decimal`
    function shiftLeft(int192 x, int8 decimals) internal pure returns (int192) {
        int256 coeff = decimals >= 0 ? int256(10**uint8(decimals)) : int256(10**uint8(-decimals));
        return _safe_wrap(decimals >= 0 ? x * coeff : x / coeff);
    }

    /// Round this int192 to the nearest int. If equidistant to both
    /// adjacent ints, round up, away from zero.
    function intRound(int192 x) internal pure returns (int192) {
        int256 x_ = x;
        int256 adjustment = x_ >= 0 ? FIX_SCALE / 2 : -FIX_SCALE / 2;
        int256 rounded = (x_ + adjustment) / FIX_SCALE;
        if (rounded < type(int192).min || type(int192).max < rounded) revert IntOutOfBounds();
        return int192(rounded);
    }

    /// Add a int192 to this int192.
    function plus(int192 x, int192 y) internal pure returns (int192) {
        return x + y;
    }

    /// Add a uint to this int192.
    function plusu(int192 x, uint256 y) internal pure returns (int192) {
        if (y > type(uint256).max / 2) revert UIntOutOfBounds();
        int256 y_ = int256(y);
        return _safe_wrap(x + y_ * FIX_SCALE);
    }

    /// Subtract a int192 from this int192.
    function minus(int192 x, int192 y) internal pure returns (int192) {
        return x - y;
    }

    /// Subtract a uint from this int192.
    function minusu(int192 x, uint256 y) internal pure returns (int192) {
        if (y > type(uint256).max / 2) revert UIntOutOfBounds();

        return _safe_wrap(int256(x) - int256(y * FIX_SCALE_U));
    }

    /// Multiply this int192 by a int192.
    /// Round truncated values to the nearest available value. 5e-19 rounds away from zero.
    function mul(int192 x, int192 y) internal pure returns (int192) {
        int256 naive_prod = int256(x) * int256(y);
        int256 rounding_adjustment = naive_prod >= 0 ? FIX_SCALE / 2 : -FIX_SCALE / 2;
        return _safe_wrap((naive_prod + rounding_adjustment) / FIX_SCALE);
    }

    /// Multiply this int192 by a uint.
    function mulu(int192 x, uint256 y) internal pure returns (int192) {
        if (y > type(uint256).max / 2) revert UIntOutOfBounds();
        return _safe_wrap(x * int256(y));
    }

    /// Divide this int192 by a int192; round the fractional part towards zero.
    function div(int192 x, int192 y) internal pure returns (int192) {
        // Multiply-in FIX_SCALE before dividing by y to preserve right-hand digits of result.
        int256 shift_x = int256(x) * FIX_SCALE;
        return _safe_wrap(shift_x / y);
    }

    /// Divide this int192 by a uint.
    function divu(int192 x, uint256 y) internal pure returns (int192) {
        if (y > type(uint256).max / 2) return FIX_ZERO;
        return _safe_wrap(x / int256(y));
    }

    /// Divide this int192 by a uint. Round the result to the *nearest* int192, instead of truncating.
    /// Values at exactly 0.5 are rounded up.
    function divuRound(int192 x_, uint256 y_) internal pure returns (int192) {
        if (y_ > type(uint256).max / 2) return FIX_ZERO;
        int256 y = int256(y_);
        int256 x = int256(x_);
        int8 sign = (x < 0) ? -1 : int8(1);
        x *= sign;
        return _safe_wrap(((x + y / 2) / y) * sign);
    }

    /// Compute 1 / (this int192).
    function inv(int192 x) internal pure returns (int192) {
        return div(FIX_ONE, x);
    }

    /// Raise this int192 to a nonnegative integer power.
    /// Presumes that powu(0.0, 0) = 1
    /// @dev The gas cost is O(lg(y)). We can maybe do better but it will get very fiddly indeed.
    function powu(int192 x, uint256 y) internal pure returns (int192 result) {
        // The algorithm is exponentiation by squaring. See: https://w.wiki/4LjE
        result = FIX_ONE;
        if (eq(x, FIX_ONE)) return FIX_ONE;
        while (true) {
            if (y & 1 == 1) result = mul(result, x);
            if (y <= 1) return result;
            y = y >> 1;
            x = mul(x, x);
        }
    }

    /// Increment by 1 part in FIX_SCALE
    function increment(int192 x) internal pure returns (int192 result) {
        return _safe_wrap(int256(x) + 1);
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

    function muluDivu(
        int192 x,
        uint256 y,
        uint256 z
    ) internal pure returns (int192) {
        return _safe_wrap(int256(mulDiv(uint256(uint192(x)), y, z)));
    }
}

/// mulDiv: return (x*y/z), overflowing *only* if the end result is out of range.
///   Adapted from sources:
///   https://medium.com/coinmonks/4db014e080b1, https://medium.com/wicketh/afa55870a65
///   and quite a few of the other excellent "Mathemagic" posts from https://medium.com/wicketh
function mulDiv(
    uint256 x,
    uint256 y,
    uint256 z
) pure returns (uint256 result) {
    unchecked {
        (uint256 l, uint256 h) = fullMul(x, y);
        require(h < z);
        uint256 mm = mulmod(x, y, z);
        if (mm > l) h -= 1;
        l -= mm;
        uint256 pow2 = z & (0 - z);
        z /= pow2;
        l /= pow2;
        l += h * ((0 - pow2) / pow2 + 1);
        uint256 r = 1;
        r *= 2 - z * r;
        r *= 2 - z * r;
        r *= 2 - z * r;
        r *= 2 - z * r;
        r *= 2 - z * r;
        r *= 2 - z * r;
        r *= 2 - z * r;
        r *= 2 - z * r;
        result = l * r;
    }
}

/// fullMul: return (x*y) as a "virtual uint512"
/// The computed result is (h*2^256 + l)
///   Adapted from sources:
///   https://medium.com/wicketh/27650fec525d, https://medium.com/coinmonks/4db014e080b1
function fullMul(uint256 x, uint256 y) pure returns (uint256 l, uint256 h) {
    unchecked {
        uint256 mm = mulmod(x, y, uint256(0) - uint256(1));
        l = x * y;
        h = mm - l;
        if (mm < l) h -= 1;
    }
}
