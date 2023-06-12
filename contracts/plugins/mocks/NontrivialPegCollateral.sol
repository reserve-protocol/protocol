// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../assets/FiatCollateral.sol";

contract NontrivialPegCollateral0 is FiatCollateral {
    uint192 private peg = FIX_ONE; // {target/ref}

    constructor(CollateralConfig memory config) FiatCollateral(config) {}

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public view virtual override returns (uint192) {
        return 1e9;
    }
}

contract NontrivialPegCollateral1 is FiatCollateral {
    uint192 private peg = FIX_ONE; // {target/ref}

    constructor(CollateralConfig memory config) FiatCollateral(config) {}

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public view virtual override returns (uint192) {
        return 5e17;
    }
}

contract NontrivialPegCollateral2 is FiatCollateral {
    uint192 private peg = FIX_ONE; // {target/ref}

    constructor(CollateralConfig memory config) FiatCollateral(config) {}

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public view virtual override returns (uint192) {
        return 2e18;
    }
}

contract NontrivialPegCollateral3 is FiatCollateral {
    uint192 private peg = FIX_ONE; // {target/ref}

    constructor(CollateralConfig memory config) FiatCollateral(config) {}

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public view virtual override returns (uint192) {
        return 1e27;
    }
}
