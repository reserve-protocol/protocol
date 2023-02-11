# Property Glossary

Common concepts for understanding property and invariant comments in the Deep Review.

I'm basically using python notation for things -- set and list comprehensions, the meaning of .set and .get and `in` on maps, and so on.

Function comments contain:

- checks: Conditions that must be true for a function call to be valid. If any check is false, then the function must revert. If all checks are true, then the function should not revert unless some specified action reverts. If "checks" is omitted, then there are no conditions.

- effects: State changes inside _this_ contract. Written in prestate/poststate format, where `foo` is a prestate variable and `foo'` is a poststate variable. Any elements of state not explicitly mentioned must not change. If "effects" is omitted, then there are no state changes.

- actions: At a lowest level, the series of mutating calls into other contracts that this function will make. If "actions" is omitted, then there are no mutating calls to other contracts.

- returns: The return value. Omitted if it's on a relatively obvious view function.

I'm generally not documenting our governance-parameter setters like this, though I _am_ thinking through what checks they make.

# General Notes

Contract invariants are assumed to hold after every function call, _once_ its init() has been called. We don't really try to analyze what state the contract might be in before then -- except to say that its value for `initialized` must be fale.

# Assumptions

- The return value of erc20() is invariant for each Asset deployment.
- For any map, the documentation function `keys(m)` is the set of all keys `k` such that `m[k]` is not the zero value.
