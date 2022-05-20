// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/abstract/AaveOracleMixin.sol";
import "contracts/plugins/assets/abstract/Collateral.sol";

contract AavePricedFiatCollateral is AaveOracleMixin, Collateral {
    constructor(
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IComptroller comptroller_,
        IAaveLendingPool aaveLendingPool_
    ) {
        init(
            erc20_,
            maxTradeVolume_,
            defaultThreshold_,
            delayUntilDefault_,
            comptroller_,
            aaveLendingPool_
        );
    }

    function init(
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IComptroller comptroller_,
        IAaveLendingPool aaveLendingPool_
    ) public initializer {
        __Collateral_init(
            erc20_,
            maxTradeVolume_,
            defaultThreshold_,
            delayUntilDefault_,
            erc20_,
            bytes32(bytes("USD"))
        );
        __AaveOracleMixin_init(comptroller_, aaveLendingPool_);
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual returns (uint192) {
        return consultOracle(erc20);
    }

    // solhint-disable no-empty-blocks
    /// Update any collateral state that can change due to reentrancy.
    function refreshVolatiles() public virtual override {
        // no action here; the price is just an oracle value, which we expect
        // not to be volatile under reentrancy.
    }
}
