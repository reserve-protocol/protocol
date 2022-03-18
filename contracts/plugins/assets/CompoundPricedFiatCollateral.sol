// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/abstract/Collateral.sol";
import "contracts/plugins/assets/abstract/CompoundOracleMixin.sol";

contract CompoundPricedFiatCollateral is CompoundOracleMixin, Collateral {
    // solhint-disable no-empty-blocks
    constructor(
        IERC20Metadata erc20_,
        int192 maxTradeVolume_,
        int192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IComptroller comptroller_
    )
        Collateral(
            erc20_,
            maxTradeVolume_,
            defaultThreshold_,
            delayUntilDefault_,
            erc20_,
            bytes32(bytes("USD"))
        )
        CompoundOracleMixin(comptroller_)
    {}

    // solhint-enable no-empty-blocks

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (int192) {
        return consultOracle(erc20);
    }
}
