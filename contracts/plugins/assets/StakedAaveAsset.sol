// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/AavePricedAsset.sol";

interface IStkAAVE {
    // solhint-disable-next-line func-name-mixedcase
    function STAKED_TOKEN() external view returns (IERC20Metadata);
}

contract StakedAaveAsset is AavePricedAsset {
    // solhint-disable no-empty-blocks
    constructor(
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        IComptroller comptroller_,
        IAaveLendingPool aaveLendingPool_
    ) AavePricedAsset(erc20_, maxTradeVolume_, comptroller_, aaveLendingPool_) {}

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (uint192) {
        return consultOracle(address(IStkAAVE(address(erc20)).STAKED_TOKEN()));
    }
}
