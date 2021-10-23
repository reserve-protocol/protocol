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

library FixLib {
    /// @title FIX library: Static members of the "Fix" class.

    /// Constants, and functions that create Fix values from other types.

    /// If a particular Fix is represented by the int128 n, then the Fix represents the
    /// value n/SCALE.
    uint internal constant SCALE = 1e18;
    /// The largest integer that can be converted to Fix.
    uint internal constant MAX_FIXABLE_INT = type(int128).max / SCALE;
    /// The smallest integer that can be converted to Fix.
    int internal constant MIN_FIXABLE_INT = type(int128).min / SCALE;

    /// The Fix representation of zero.
    Fix internal constant ZERO = Fix.wrap(0);
    /// The Fix representation of one.
    Fix internal constant ONE = Fix.wrap(SCALE);

    /// The largest Fix. (Not an integer!)
    Fix internal constant MAX = Fix.wrap(type(int128).max);
    /// The smallest Fix.
    Fix internal constant MIN = Fix.wrap(type(int128).min);

    /// Convert an int to its Fix representation. Fails if x is outside Fix's representable range.
    function ofInt(int256 x) internal pure returns (Fix) {
        if (x < MIN_FIXABLE_INT || MAX_FIXABLE_INT < x) { revert IntOutOfBounds(x); }
        return Fix.wrap(int128(x * SCALE));
    }
    /// Convert a uint to its Fix representation. Fails if x is outside Fix's representable range.
    function ofUint(uint256 x) internal pure returns (Fix) {
        if (MAX_FIXABLE_INT < x) { revert UIntOutOfBounds(x); }
        return Fix.wrap(int128(x * 1e18));
    }
}

 library FixMembers {
     /// Convert a Fix to an int, rounding the fractional part towards zero.
     function toInt(Fix x) internal pure returns (int128) {
         return Fix.unwrap(x) / FIX.SCALE;
     }
     /// Convert a Fix to a uint, rounding the fractional part towards zero.
     function toUInt(Fix x) internal pure returns (uint128) {
         int128 n = Fix.unwrap(x);
         if (n < 0) { revert IntOutOfBounds(n); }
         return uint128(n) / FIX.SCALE;
     }

     /// Add two Fixes. Fail if the result is out of bounds.
     function plus(Fix x, Fix y) internal pure returns (Fix) {
         return fix.wrap(fix.unwrap(x) + fix.unwrap(y));
     }
     /// Add to an int. Fail if the result is out of bounds.
     function plusi(Fix x, int256 y) internal pure returns (Fix) {
         return fix.wrap( int128(Fix.unwrap(x) + y * SCALE) );
     }
     /// Add to a uint. Fail if the result is out of bounds.
     function plusu(Fix x, uint256 y) internal pure returns (Fix) {
         return fix.wrap( uint128(Fix.unwrap(x) + y * SCALE) );
     }

     /// Subtract one Fix from another. Fail if the result is out of bounds.
     function minus(Fix x, Fix y) internal pure returns (Fix) {
         return fix.wrap(fix.unwrap(x) - fix.unwrap(y));
     }
     /// Subtract away an int. Fail if the result is out of bounds.
     function minusi(Fix x, int256 y) internal pure returns (Fix) {
         return fix.wrap( int128(Fix.unwrap(x) - y * SCALE) );
     }
     /// Subtract away a uint. Fail if the result is out of bounds.
     function minusu(Fix x, uint256 y) internal pure returns (Fix) {
         return fix.wrap( uint128(Fix.unwrap(x) - y * SCALE) );
     }

     /// Multiply two Fixes. Fail if the result is out of bounds.
     // HERE TODO
 }
