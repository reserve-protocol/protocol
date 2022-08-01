// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/Asset.sol";
import "contracts/interfaces/IRToken.sol";

contract RTokenAsset is Asset {
    // solhint-disable no-empty-blocks
    /// @param tradingRange_ {tok} The min and max of the trading range for this asset
    constructor(IRToken rToken_, TradingRange memory tradingRange_)
        Asset(
            AggregatorV3Interface(address(1)),
            IERC20Metadata(address(rToken_)),
            IERC20Metadata(address(0)),
            tradingRange_,
            1
        )
    {}

    // solhint-enable no-empty-blocks

    /// @return {UoA/rTok}
    function price() public view override returns (uint192) {
        return IRToken(address(erc20)).price();
    }
}
