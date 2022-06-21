// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/Asset.sol";

contract StakedAaveAsset is Asset {
    // solhint-disable no-empty-blocks
    constructor(
        IMain main_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_
    ) Asset(main_, erc20_, maxTradeVolume_) {}

    // solhint-enable no-empty-blocks

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (uint192) {
        return main.oracle().priceUSD(bytes32(bytes("AAVE")));
    }
}
