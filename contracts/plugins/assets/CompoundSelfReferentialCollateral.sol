// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/abstract/CompoundOracleMixin.sol";
import "contracts/plugins/assets/abstract/SelfReferentialCollateral.sol";

contract CompoundSelfReferentialCollateral is SelfReferentialCollateral {
    IComptroller public comptroller;

    string public oracleLookupSymbol;

    // solhint-disable no-empty-blocks
    constructor(
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        IComptroller comptroller_,
        string memory targetName_
    ) SelfReferentialCollateral(erc20_, maxTradeVolume_, bytes32(bytes(targetName_))) {
        comptroller = comptroller_;
        oracleLookupSymbol = targetName_;
    }

    // solhint-enable no-empty-blocks

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (uint192) {
        uint256 p = comptroller.oracle().price(oracleLookupSymbol);
        if (p == 0) {
            revert PriceOutsideRange();
        }

        // D18{UoA/erc20} = {microUoA/erc20} / {microUoA/UoA}
        return uint192(p * 1e12);
    }
}
