// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/CTokenFiatCollateral.sol";

/**
 * @title CTokenSelfReferentialCollateral
 * @notice Collateral plugin for a cToken of self-referential collateral, like cETH
 * Expected: {tok} != {ref}, {ref} == {target}, {target} != {UoA}
 */
contract CTokenSelfReferentialCollateral is CTokenFiatCollateral {
    /// @param comptroller_ The CompoundFinance Comptroller
    constructor(
        CollateralConfig memory config,
        uint8 referenceERC20Decimals_,
        IComptroller comptroller_
    ) CTokenFiatCollateral(config, comptroller_) {
        require(referenceERC20Decimals_ > 0, "missing decimals");
        referenceERC20Decimals = referenceERC20Decimals_;
    }
}
