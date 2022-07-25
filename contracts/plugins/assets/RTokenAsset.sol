// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/Asset.sol";
import "contracts/interfaces/IMain.sol";

contract RTokenAsset is Asset {
    IMain public immutable main;

    /// @param tradingRange_ {tok} The min and max of the trading range for this asset
    constructor(
        IMain main_,
        IERC20Metadata erc20_,
        TradingRange memory tradingRange_
    )
        Asset(
            AggregatorV3Interface(address(1)),
            erc20_,
            IERC20Metadata(address(0)),
            tradingRange_,
            1
        )
    {
        main = main_;
    }

    /// @return {UoA/rTok}
    function price() public view override returns (uint192) {
        return main.rToken().price();
    }
}
