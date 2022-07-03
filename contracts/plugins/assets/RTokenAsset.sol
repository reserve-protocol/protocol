// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/Asset.sol";
import "contracts/interfaces/IMain.sol";

contract RTokenAsset is Asset {
    IMain public immutable main;

    /// @param maxTradeVolume_ {UoA} The max amount of value to trade in an indivudual trade
    constructor(
        IMain main_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_
    ) Asset(AggregatorV3Interface(address(1)), erc20_, maxTradeVolume_, 1) {
        main = main_;
    }

    /// @return {UoA/rTok}
    function price() public view override returns (uint192) {
        return main.rToken().price();
    }
}
