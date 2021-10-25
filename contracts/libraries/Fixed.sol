// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.9;

/// @title FixedPoint, a fixed-point arithmetic library defining the custom type Fix
/// @author Matt Elder <matt.elder@reserve.org> and the Reserve Team <https://reserve.org>

/** @notice The type `Fix` is a 128 bit value, representing an 18-decimal Fixed-point
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

/// An int value passed to this library was out of bounds for Fix operations
error IntOutOfBounds(int value);
/// A uint value passed to this library was out of bounds for Fix operations
error UIntOutOfBounds(uint value);

/// The central type this library provides. You'll declare values of this type.
type Fix is int128;

/// If a particular Fix is represented by the int128 n, then the Fix represents the
/// value n/FIX_SCALE.
uint internal constant FIX_SCALE = 1e18;

/// The largest integer that can be converted to Fix.
uint internal constant FIX_MAX_INT = type(int128).max / FIX_SCALE;

/// The smallest integer that can be converted to Fix.
int internal constant FIX_MIN_INT = type(int128).min / FIX_SCALE;


Fix internal constant FIX_ZERO = Fix.wrap(0);               /// The Fix representation of zero.
Fix internal constant FIX_ONE = Fix.wrap(FIX_SCALE);            /// The Fix representation of one.
Fix internal constant FIX_MAX = Fix.wrap(type(int128).max); /// The largest Fix. (Not an integer!)
Fix internal constant FIX_MIN = Fix.wrap(type(int128).min); /// The smallest Fix.

/// Convert a uint to its Fix representation. Fails if x is outside Fix's representable range.
function toFix(uint256 x) internal pure returns (Fix) {
    if (MAX_FIXABLE_INT < x) { revert UIntOutOfBounds(x); }
    return Fix.wrap(int128(x * FIX_SCALE));
}
/// Convert an int to its Fix representation. Fails if x is outside Fix's representable range.
function intToFix(int256 x) internal pure returns (Fix) {
    if (x < MIN_FIXABLE_INT || MAX_FIXABLE_INT < x) { revert IntOutOfBounds(x); }.
    return Fix.wrap(int128(x * FIX_SCALE));
}

 library FixLib {
     /// All arithmetic functions fail if and only if the result is out of bounds.

     /// Convert this Fix to an int. Round the fractional part towards zero.
     function toInt(Fix x) internal pure returns (int128) {
         return Fix.unwrap(x) / FIX_SCALE;
     }
     /// Convert this Fix to a uint. Round the fractional part towards zero.
     function toUint(Fix x) internal pure returns (uint128) {
         int128 n = Fix.unwrap(x);
         if (n < 0) { revert IntOutOfBounds(n); }
         return uint128(n) / FIX_SCALE;
     }
     /// Round this Fix to the nearest int. Round 5e-19 towards zero.
     function round(Fix x) internal pure returns (int128) {
         int128 rounding_adjustment = (x >= 0 ? 1 : -1) * FIX_SCALE/2;
         return Fix.unwrap((x + rounding_adjustment) / FIX_SCALE);
     }

     /// Add a Fix to this Fix.
     function plus(Fix x, Fix y) internal pure returns (Fix) {
         return Fix.wrap(Fix.unwrap(x) + Fix.unwrap(y));
     }
     /// Add an int to this Fix.
     function plusi(Fix x, int256 y) internal pure returns (Fix) {
         return Fix.wrap( int128(Fix.unwrap(x) + y * FIX_SCALE) );
     }
     /// Add a uint to this Fix.
     function plusu(Fix x, uint256 y) internal pure returns (Fix) {
         return Fix.wrap( int128(Fix.unwrap(x) + y * FIX_SCALE) );
     }

     /// Subtract a Fix from this Fix.
     function minus(Fix x, Fix y) internal pure returns (Fix) {
         return Fix.wrap(Fix.unwrap(x) - Fix.unwrap(y));
     }
     /// Subtract an int from this Fix.
     function minusi(Fix x, int256 y) internal pure returns (Fix) {
         return Fix.wrap( int128(Fix.unwrap(x) - y * FIX_SCALE) );
     }
     /// Subtract a uint from this Fix.
     function minusu(Fix x, uint256 y) internal pure returns (Fix) {
         return Fix.wrap( int128(Fix.unwrap(x) - y * FIX_SCALE) );
     }

     /// Multiply this Fix by a Fix.
     /// Round truncated values to the nearest available value. 5e-19 rounds towards zero.
     function times(Fix x, Fix y) internal pure returns (Fix) {
         int256 naive_prod = Fix.unwrap(x) * Fix.unwrap(y);
         int256 rounding_adjustment = (naive_prod >= 0 ? 1 : -1) * FIX_SCALE/2;
         return Fix.wrap(int128(naive_prod + rounding_adjustment / FIX_SCALE));
     }
     /// Multiply this Fix by an int.
     function timesi(Fix x, int256 y) internal pure returns (Fix) {
         return Fix.wrap(int128(Fix.unwrap(x) * y));
     }
     /// Multiply this Fix by a uint.
     function timesu(Fix x, uint256 y) internal pure returns (Fix) {
         return Fix.wrap(int128(Fix.unwrap(x) * y));
     }

     /// Divide this Fix by a Fix; round the fractional part towards zero.
     function div(Fix x, Fix y) internal pure returns (Fix) {
         // Multiply-in FIX_SCALE before dividing by y to preserve right-hand digits of result.
         int256 shift_x = int256(Fix.unwrap(x)) * FIX_SCALE;
         return Fix.wrap(int128(shift_x / Fix.unwrap(y)))
     }
     /// Divide this Fix by an int.
     function divi(Fix x, int256 y) internal pure returns (Fix) {
         return Fix.wrap(int128(Fix.unwrap(x) / y));
     }
     /// Divide this Fix by a uint.
     function divu(Fix x, uint256 y) internal pure returns (Fix) {
         return Fix.wrap(int128(Fix.unwrap(x) / y));
     }

     /// Raise this Fix to a (positive integer) power.
     /// @dev The gas cost is O(lg(y)). We can probably do better, but it will get fiddly.
     function powu(Fix x, uint256 y) internal pure returns (Fix) {
         // Algorithm is exponentiation by squaring.
         // see: https://en.wikipedia.org/wiki/Exponentiation_by_squaring
         Fix res = FIX_ONE;
         Fix square = x;
         for (; y > 0; y = y >> 1) {
             if (y & 0x1) {
                 res = res.times(square);
             }
             square = square.times(square);
         }
         return res;
     }

     /// Comparison operators...
     function lt(Fix x, Fix y) internal pure returns(bool) { return Fix.unwrap(x) < Fix.unwrap(y); }
     function lte(Fix x, Fix y) internal pure returns(bool) { return Fix.unwrap(x) <= Fix.unwrap(y); }
     function gt(Fix x, Fix y) internal pure returns(bool) { return Fix.unwrap(x) > Fix.unwrap(y); }
     function gte(Fix x, Fix y) internal pure returns(bool) { return Fix.unwrap(x) >= Fix.unwrap(y); }
     function eq(Fix x, Fix y) internal pure returns(bool) { return Fix.unwrap(x) == Fix.unwrap(y); }
     function neq(Fix x, Fix y) internal pure returns(bool) { return Fix.unwrap(x) !== Fix.unwrap(y); }

     /// Return whether or not this Fix is within epsilon of y.
     function near(Fix x, Fix y, Fix epsilon) internal pure returns (bool) {
         int128 x_ = Fix.unwrap(x);
         int128 y_ = Fix.unwrap(y);

         int128 diff = (x_ <= y_) ? (y_ - x_) : (x_ - y_);
         return diff <= Fix.unwrap(epsilon);
     }
 }
