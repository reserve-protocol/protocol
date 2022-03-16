// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/libraries/Fixed.sol";

// ==== External Interfaces  ====
// see: https://github.com/compound-finance/compound-protocol/tree/master/contracts
interface IComptroller {
    function oracle() external view returns (ICompoundOracle);

    function claimComp(address holder) external;
}

interface ICompoundOracle {
    /// @return {microUoA/tok} The UoA price of the corresponding token with 6 decimals.
    function price(string memory symbol) external view returns (uint256);
}

// ==== End External Interfaces ====

abstract contract CompoundOracleMixin {
    using FixLib for int192;

    IComptroller public immutable comptroller;

    constructor(IComptroller comptroller_) {
        comptroller = comptroller_;
    }

    /// @return {UoA/erc20}
    function consultOracle(IERC20Metadata erc20) internal view virtual returns (int192) {
        // Compound stores prices with 6 decimals of precision

        uint256 p = comptroller.oracle().price(erc20.symbol());
        if (p == 0) {
            revert PriceIsZero();
        }

        // {UoA/tok} = {microUoA/tok} / {microUoA/UoA}
        return toFix(p).shiftLeft(-6);
    }
}
