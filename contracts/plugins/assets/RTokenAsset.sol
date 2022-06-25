// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/Asset.sol";
import "contracts/interfaces/IMain.sol";

contract RTokenAsset is Asset {
    IMain public main;

    constructor(
        IMain main_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_
    ) Asset(AggregatorV3Interface(address(0)), erc20_, maxTradeVolume_) {
        RTokenAsset_init(main_);
    }

    // solhint-disable no-empty-blocks
    // solhint-disable-next-line func-name-mixedcase
    function RTokenAsset_init(IMain main_) public initializer {
        main = main_;
    }

    // solhint-enable no-empty-blocks

    /// @return {UoA/rTok}
    function price() public view override returns (uint192) {
        return main.rToken().price();
    }
}
