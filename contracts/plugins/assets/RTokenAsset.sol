// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/Asset.sol";
import "contracts/interfaces/IMain.sol";

contract RTokenAsset is Asset {
    IMain public main;

    // solhint-disable-next-line func-name-mixedcase
    function RTokenAsset_init(
        IMain main_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_
    ) external initializer {
        __Asset_init(AggregatorV3Interface(address(0)), erc20_, maxTradeVolume_);
        __RTokenAsset_init(main_);
    }

    // solhint-disable-next-line func-name-mixedcase
    function __RTokenAsset_init(IMain main_) internal onlyInitializing {
        main = main_;
    }

    /// @return {UoA/rTok}
    function price() public view override returns (uint192) {
        return main.rToken().price();
    }
}
