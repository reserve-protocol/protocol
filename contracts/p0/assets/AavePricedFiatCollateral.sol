// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/p0/assets/abstract/AaveOracleMixin.sol";
import "contracts/p0/assets/abstract/Collateral.sol";

contract AavePricedFiatCollateralP0 is AaveOracleMixinP0, CollateralP0 {
    // solhint-disable no-empty-blocks
    constructor(
        IERC20Metadata erc20_,
        Fix maxAuctionSize_,
        IMain main_,
        IComptroller comptroller_,
        IAaveLendingPool aaveLendingPool_
    )
        CollateralP0(erc20_, maxAuctionSize_, erc20_, main_, bytes32(bytes("USD")))
        AaveOracleMixinP0(comptroller_, aaveLendingPool_)
    {}

    // solhint-enable no-empty-blocks

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (Fix) {
        return consultOracle(erc20);
    }
}
