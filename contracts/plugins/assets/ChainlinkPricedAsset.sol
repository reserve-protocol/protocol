// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/abstract/Asset.sol";
import "contracts/plugins/assets/abstract/ChainlinkOracleMixin.sol";

contract ChainlinkPricedAsset is ChainlinkOracleMixin, Asset {
    // solhint-disable no-empty-blocks
    constructor(
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        address priceFeed_
    ) Asset(erc20_, maxTradeVolume_) ChainlinkOracleMixin(priceFeed_) {}

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (uint192) {
        return consultOracle();
    }
}
