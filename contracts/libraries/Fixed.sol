// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.9;

/// @title FixedPoint, a fixed-point arithmetic library defining the custom type Fix
/// @author Matt Elder <matt.elder@reserve.org> and the Reserve Team <https://reserve.org>

/** The type `Fix` is a 192 bit value, representing an 18-decimal Fixed-point
    fractional value.  This is what's described in the Solidity documentation as
    "fixed192x18" -- a value represented by 192 bits, that makes 18 digits available to
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
type Fix is int192;

// If a particular Fix is represented by the int192 n, then the Fix represents the
// value n/FIX_SCALE.
int64 constant FIX_SCALE = 1e18;
uint64 constant FIX_SCALE_U = uint64(FIX_SCALE);
// FIX_SCALE Squared:
int128 constant FIX_SCALE_SQ = 1e36;
uint128 constant FIX_SCALE_SQ_U = uint128(FIX_SCALE_SQ);

// The largest integer that can be converted to Fix.
// This is a bit bigger than 3.1e39
int192 constant FIX_MAX_INT = type(int192).max / FIX_SCALE;

// The smallest integer that can be converted to Fix.
// This is a bit less than -3.1e39
int192 constant FIX_MIN_INT = type(int192).min / FIX_SCALE;

Fix constant FIX_ZERO = Fix.wrap(0); // The Fix representation of zero.
Fix constant FIX_ONE = Fix.wrap(FIX_SCALE); // The Fix representation of one.
Fix constant FIX_MAX = Fix.wrap(type(int192).max); // The largest Fix. (Not an integer!)
Fix constant FIX_MIN = Fix.wrap(type(int192).min); // The smallest Fix.

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
function _safe_wrap(int256 x) pure returns (Fix) {
    if (x < type(int192).min || type(int192).max < x) revert IntOutOfBounds(x);
    return Fix.wrap(int192(x));
}

/// Convert a uint to its Fix representation. Fails if x is outside Fix's representable range.
function toFix(uint256 x) pure returns (Fix) {
    if (uint192(FIX_MAX_INT) < x) {
        revert UIntOutOfBounds(x);
    }
    return Fix.wrap(int192(uint192(x)) * FIX_SCALE);
}

/// Convert a uint to its Fix representation after shifting its value `shiftLeft` digits.
/// Fails if the shifted value is outside Fix's representable range.
function toFixWithShift(uint256 x, int8 shiftLeft) pure returns (Fix) {
    if (x == 0 || shiftLeft < -95) return Fix.wrap(0); // shift would clear a uint256; 0 -> 0
    if (59 < shiftLeft) revert IntOutOfBounds(shiftLeft); // would unconditionally overflow x

    shiftLeft += 18;
    uint256 shifted = (shiftLeft >= 0) ? x * 10**uint256(uint8(shiftLeft)) : x / 10**(uint256(uint8(-shiftLeft)));

    if (uint192(type(int192).max) < shifted) revert UIntOutOfBounds(shifted);
    return Fix.wrap(int192(uint192(shifted)));
}

/// Convert an int to its Fix representation. Fails if x is outside Fix's representable range.
function intToFix(int256 x) pure returns (Fix) {
    return _safe_wrap(x * FIX_SCALE);
}

/// Divide a uint by a Fix. Fails if the result is outside Fix's representable range.

/** @dev This is about this simplest way to do this. It also Just Works in all cases where the
 * result fits in Fix, which may be surprising. See docs/fixlib-reasoning.md in this repo for the
 * worked logic by which this case is correct, and also the principles by which you can reason that
 * all these other functions are similarly correct.
 */

function divFix(uint256 x, Fix y) pure returns (Fix) {
    int256 _y = int256(Fix.unwrap(y));
    /* If we didn't have to worry about overflow or precision loss, we'd just do:
       return x * 1e36 / _y.
    */
    // If it's safe to do this operation the easy way, do it:
    if (x < uint256(type(int256).max / FIX_SCALE_SQ)) {
        return _safe_wrap(int256(x * FIX_SCALE_SQ_U) / _y);
    }
    /* If we're not in that safe range, there are still lots of situations where the output fits in
     * a Fix, but (x * 1e36) does not fit in a uint256. For instance, x = 2**255; _y = 2**190. For
     * such cases, we've got to compute result = [x * 1e36 / _y] in a way that only leaves the bounds
     * of a uint256 if the result won't fit in a Fix.

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

function fixMin(Fix x, Fix y) pure returns (Fix) {
    return FixLib.lt(x, y) ? x : y;
}

function fixMax(Fix x, Fix y) pure returns (Fix) {
    return FixLib.gt(x, y) ? x : y;
}

library FixLib {
    /// All arithmetic functions fail if and only if the result is out of bounds.

    /// Convert this Fix to a uint. Fail if x is negative. Round the fractional part towards zero.
    function floor(Fix x) internal pure returns (uint192) {
        int192 n = Fix.unwrap(x);
        if (n < 0) {
            revert IntOutOfBounds(n);
        }
        return uint192(n) / FIX_SCALE_U;
    }

    /// Convert this Fix to a uint with standard rounding to the nearest integer.
    function round(Fix x) internal pure returns (uint192) {
        int192 n = Fix.unwrap(x);
        if (n < 0) {
            revert IntOutOfBounds(n);
        }
        return uint192(intRound(x));
    }

    /// Convert this Fix to a uint. Round the fractional part towards one.
    function ceil(Fix x) internal pure returns (uint192) {
        uint192 u = floor(x);
        if (uint192(Fix.unwrap(x)) == u * FIX_SCALE_U) { return u;}
        return u+1;
    }

    /// Convert this Fix to a uint, applying the rounding approach described by the enum
    function toUint(Fix x, RoundingApproach rounding) internal pure returns (uint192) {
        if (rounding == RoundingApproach.ROUND) {
            return round(x);
        } else if (rounding == RoundingApproach.CEIL) {
            return ceil(x);
        }
        return floor(x);
    }
    
    /// Convert this Fix to an int. Round the fractional part towards zero.
    function toInt(Fix x) internal pure returns (int192) {
        return Fix.unwrap(x) / FIX_SCALE;
    }


    /// Return the Fix shifted to the left by `decimal` digits
    /// Similar to a bitshift but in base 10
    /// Equivalent to multiplying `x` by `10**decimal`
    function shiftLeft(Fix x, int8 decimals) internal pure returns (Fix) {
        int256 coeff = decimals >= 0 ? int256(10**uint8(decimals)) : int256(10**uint8(-decimals));
        return _safe_wrap(decimals >= 0 ? Fix.unwrap(x) * coeff : Fix.unwrap(x) / coeff);
    }
 
    /// Round this Fix to the nearest int. If equidistant to both
    /// adjacent ints, round up, away from zero.
    function intRound(Fix x) internal pure returns (int192) {
        int256 x_ = Fix.unwrap(x);
        int256 adjustment = x_ >= 0 ? FIX_SCALE / 2 : -FIX_SCALE / 2;
        int256 rounded = (x_ + adjustment) / FIX_SCALE;
        if (rounded < type(int192).min || type(int192).max < rounded) revert IntOutOfBounds(rounded);
        return int192(rounded);
    }

    /// Add a Fix to this Fix.
    function plus(Fix x, Fix y) internal pure returns (Fix) {
        return Fix.wrap(Fix.unwrap(x) + Fix.unwrap(y));
    }

    /// Add an int to this Fix.
    function plusi(Fix x, int256 y) internal pure returns (Fix) {
        int256 result = Fix.unwrap(x) + y * FIX_SCALE;
        return _safe_wrap(result);
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
        return _safe_wrap(Fix.unwrap(x) - y * FIX_SCALE);
    }

    /// Subtract a uint from this Fix.
    function minusu(Fix x, uint256 y) internal pure returns (Fix) {
        if (y > type(uint256).max / 2) {
            revert UIntOutOfBounds(y);
        }
        return _safe_wrap(int256(Fix.unwrap(x)) - int256(y * FIX_SCALE_U));
    }

    /// Multiply this Fix by a Fix.
    /// Round truncated values to the nearest available value. 5e-19 rounds away from zero.
    function mul(Fix x, Fix y) internal pure returns (Fix) {
        int256 naive_prod = int256(Fix.unwrap(x)) * int256(Fix.unwrap(y));
        int256 rounding_adjustment = naive_prod >= 0 ? FIX_SCALE / 2 : -FIX_SCALE / 2;
        return _safe_wrap((naive_prod + rounding_adjustment) / FIX_SCALE);
    }

    /// Multiply this Fix by an int.
    function muli(Fix x, int256 y) internal pure returns (Fix) {
        return _safe_wrap(Fix.unwrap(x) * y);
    }

    /// Multiply this Fix by a uint.
    function mulu(Fix x, uint256 y) internal pure returns (Fix) {
        if (y > type(uint256).max / 2) {
            revert UIntOutOfBounds(y);
        }
        return _safe_wrap(Fix.unwrap(x) * int256(y));
    }

    /// Divide this Fix by a Fix; round the fractional part towards zero.
    function div(Fix x, Fix y) internal pure returns (Fix) {
        // Multiply-in FIX_SCALE before dividing by y to preserve right-hand digits of result.
        int256 shift_x = int256(Fix.unwrap(x)) * FIX_SCALE;
        return _safe_wrap(shift_x / Fix.unwrap(y));
    }

    /// Divide this Fix by an int.
    function divi(Fix x, int256 y) internal pure returns (Fix) {
        return _safe_wrap(Fix.unwrap(x) / y);
    }

    /// Divide this Fix by a uint.
    function divu(Fix x, uint256 y) internal pure returns (Fix) {
        if (y > type(uint256).max / 2) {
            return FIX_ZERO;
        }
        return _safe_wrap(Fix.unwrap(x) / int256(y));
    }

    /// Compute 1 / (this Fix).
    function inv(Fix x) internal pure returns (Fix) {
        return div(FIX_ONE, x);
    }

    /// Raise this Fix to a nonnegative integer power.
    /// Presumes that powu(0.0, 0) = 1
    /// @dev The gas cost is O(lg(y)). We can maybe do better but it will get very fiddly indeed.
    function powu(Fix x, uint256 y) internal pure returns (Fix result) {
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
    function increment(Fix x) internal pure returns (Fix result) {
        return _safe_wrap(int256(Fix.unwrap(x)) + 1);
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
