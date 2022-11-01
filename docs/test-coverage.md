# Test Coverage

We aim to reach in this project 100% test coverage of `P1` (Production version) through our  *unit*, *scenario*, and *integration* tests. Because we designed our tests to run and be compatible with both versions (P0 and P1) we mainly use the `public` interface of each contract in our test cases, and we rely on mocks only when strictly required. 

While working on these tests, we were able to identify some checks and validations in our contracts that would produce always the same outcome and thus, could be removed if desired. However, we decided to leave them (though may be show as uncovered) to provide additional security and alert developers during future upgrades/modifications to the code.

Below we provide a detailed list of these checks to serve as a reference when running `coverage` for this project.

## Uncovered sections

### contracts/p1/BasketHandler.sol:BasketHandlerP1
-- `goodCollateral()`: The validations against the `zero` address, `rsr`, `stRSR`, and `rToken` will never be true, because tokens in both the *basket* and *backup* configs are previously validated in `setPrimeBasket()` and `setBackupConfig()` respectively, by calling the `requireValidCollArray()` function on the input array.

-- `price():` The overflow check at the end `if (nextP < delta || nextP > FIX_MAX) ...` could not be hit so far without falling into previous validations in the code. An issue will be created for further investigation.

### contracts/p1/RToken.sol:RTokenP1
- `refundSpan()`: The revert stamement `revert("Bad refundSpan")` will never occur with the current version of the code, as this is an `internal` function and the parameters for `left` and `right` are always stored in the contract and maintained with valid values doing the entire lifecycle.

### contracts/p1/StRSR.sol:StRSRP1
- `_burn()`:  Both require statements that check for `account != address(0)` and `accountBalance >= amount` will never be false. Within the `unstake()` function, right before calling `_burn()` we are validating the user has enough balance which covers these two validations, as the zero address will never have a positive balance. No other calls to `_burn` are included in the contract.

### contracts/p1/mixins/RecollateralizationLib.sol:RecollateralizationLibP1
- `nextTradePair()`: The check at the end for `(TradeLib.isEnoughToSell(rsrAsset, ....)` will never be *false*, because if the RSR balance is too low, it would have been discarded previously as part of the basket range calculations. But we will leave this as an extra safety check. 

### contracts/plugins/assets/AbstractCollateral.sol:Collateral
- `markStatus()`: The check for `_whenDefault <= block.timestamp` will never be *true* at the top of this function, because it is only  being called from within `refresh()` which has already a check at the top for `alreadyDefaulted()`. That function would return before `markStatus()` is called with this particular condition. This is a redundant check worth keeping.

### contracts/plugins/assets/EURFiatCollateral.sol:EURFiatCollateral
- `refresh()`: The check for `if (p2 > 0)` will never be false, because if the obtained price is 0 in the `_price()`  function an exception is thrown, and would be captured in the `try/catch` stamement right above.

### contracts/plugins/assets/RTokenAsset.sol:RTokenAsset
- `strictPrice()`: The require statement that checks for `!isFallback` will always succeed, because the code would have reverted if there was any collateral in the *RToken* that needed fallback prices.

### contracts/plugins/trading/GnosisTrade.sol:GnosisTrade
- `init()`: The check for `minBuyAmtPerOrder == 0` will never be **true**, because `minBuyAmtPerOrder` will always be at least 1, based on the previous calculations. We will keep it as a safety check.

### contracts/vendor/ERC20PermitUpgradeable.sol:ERC20PermitUpgradeable
- `__ERC20Permit_init_unchained()`: This is not called during our tests so will show up uncovered.

### P0 contracts

There might be a slighly lower coverage for `P0` due to differences in the implementation which are not worth tackling with specific test cases, but we make sure it is also very close to full coverage, and that all relevant paths and logic statements are covered as well.

- `RTokenP0.vest()`: The final check `if (totalVested > 0)` will always be *true* because if there are no issuances to process it will return at the top of the function with the initial `endIf` validation. And if the issuances are not ready to vest they would revert with `Issuance not ready`. So at that point in the code there is always something that was processed and vested successfully.


      