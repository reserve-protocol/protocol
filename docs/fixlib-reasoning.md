# Reasoning About Overflow in the Fixed Library

Consistently, the guarantee made by the operations in the Fix library is that, if a function reverts due to arithmetic overflow, then the proper return result would not have overflowed its return value. The reasoning that goes into guaranteeing this is fiddly, but can be made extremely explicit. Clear, at least, if not concise.

## The General Principle ##

First, imagine a "hypothetical semantics". In the hypothetical semantics, all
intermediate operations inside each function are performed in arbitrary-precision
arithmetic without integer overflows -- but the resulting aribtrary-precision value
might be too big to fit into the function's return type. If the function's return value
doesn't fit into its return type, then that's an overflow.

In a strong sense, the hypothetical semantics defines the best overflow behavior we can
generally hope for: the result is correct whenever it's structurally possible for the
result to be correct; an overflow error of some sort is thrown in all other cases.

However, we're actually writing functions against the EVM, and it *has* overflow
semantics. To show that overflow is handled correctly, we need to show exactly this
property: If any intermediate operation overflows in the actual semantics, then the
hypothetical semantics would also have overflowed.

## Example: `divFix` ##

Here, let's reason about `divFix`, which is a somewhat fiddly case:

```solidity
function divFix(uint256 x, Fix y) pure returns (Fix) {
    constant int128 _y = Fix.unwrap(y);
    return Fix.wrap(_safe_int128(int256(x * uint128(FIX_SCALE * FIX_SCALE)) / int256(_y)));
```

This is about this simplest way to implement this, and it turns out to Just Work in all
cases where the result fits in Fix. On moderate reflection, this may be surprising --
what if `x * FIX_SCALE * FIX_SCALE` overflows `uint256`?

Walking through the logic here may be instructive, both to see that a particularly
fiddly case works correctly, and also as a guide for reasoning about the rest of these
functions.

Let `r` be the returned, possibly-fractional Fix value, and let `int128 _r = Fix.unwrap(r)`.  We
know `r = x / y`, `r = _r/1e18`, and `y = _y/1e18`, so we can rearrange to get `_r = x * 1e36 / _y`.

(I'll continue, here, to represent pure-math operations in `code font`.)

### 1. Intermediate overflow ###

Now, let's consider each intermediate operation:

1. `1e36 = FIX_SCALE * FIX_SCALE` never overflows.
2.  `x * 1e36` will overflow just if `x * 1e36 > 2^256 - 1`
3.  `int256(x * 1e36)` will overflow just if `x * 1e36 > 2^255 - 1`
4.  The expression's division could only overflow if `int256(x * 1e36) == -2^255`, which can't happen since `x` is nonnegative.

Condition 3 subsumes Condition 2, so `divFix` has an intermediate overflow exactly if:

    [i]    (x * 1e36 > 2^255-1).

### 2. Hypothetical-semantics overflow ###

The hypothetical semantics overflow just if `_r == x * 1e36 / _y` is outside the `int128` range.

Therefore, the hypothetical semantics overflow just if:

    [ii]    (x * 1e36 / _y) < -2^127   or   2^127-1 < (x 1e36 / _y)

### 3. Intermediate overflow implies hypothetical-semantics overflow ###

We need to see that, in all cases where intermediate overflow happens, hypothetical-semantics overflow would also happen.

So, let's assume we get an intermediate overflow. Thus [i] holds: `(x * 1e36) > 2^255 - 1.`

Now, let's split things up based on whether `_y` is positive, negative, or zero:

- If `_y` is zero, we (correctly!) get a divide-by-zero error.
- If `_y` is positive, then `0 < _y < 2^127`. Then, by [i], we get:
  
        (x*1e36 / _y)   >   (2^255-1) / _y   >   (2^255-1) / 2^127 == 2^128 - 1/2^127   >  2^127-1
        
  Thus, `(x*1e36 / _y) > 2^127 - 1`, which satisfies [ii], which means that the hypothetical semantics overflow.
- If `_y` is negative, then `-2^127 <= _y < 0`. Similar reasoning will work. by [i], we get:

        (x*1e36 / _y)  <  (2^255-1)/_y  <  (2^255-1)/(-2^127) == -2^128 + 1/2^127   <   -2^127
        
  Thus `(x*1e36 / _y) < -2^127`, which satisfies [ii], which means the hypothetical semantics overflow.

Therefore, in all valid cases, if we get an intermediate overflow, then the hypothetical semantics overflow.


