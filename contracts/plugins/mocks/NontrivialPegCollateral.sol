// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/Collateral.sol";

contract NontrivialPegCollateral is Collateral {
    uint192 private peg = FIX_ONE; // {target/ref}

    constructor(CollateralConfig memory config) Collateral(config) {}

    /// @param newPeg {target/ref}
    function setPeg(uint192 newPeg) external {
        peg = newPeg;
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public view virtual override returns (uint192) {
        return peg;
    }
}
