
# Contract Invariants 

- Every item in `_erc20s` is a member in `assets`.
- Every member in `assets` is an item in `_erc20s`.
- There are no duplicate items in `_erc20s`. 
    That is: `_erc20s[i] == _erc20s[j]` => `i == j`
- If `addr` is in assets, then `addr == assets[addr].erc20()`

# Function Properties

## init

After `init`, `assets'` is the mapping {`a.erc20()` -> `a` for `a` in `assets_`}
