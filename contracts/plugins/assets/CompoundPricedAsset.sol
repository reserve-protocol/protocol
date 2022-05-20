// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/abstract/Asset.sol";
import "contracts/plugins/assets/abstract/CompoundOracleMixin.sol";

contract CompoundPricedAsset is CompoundOracleMixin, Asset {
    constructor(
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        IComptroller comptroller_
    ) {
        init(erc20_, maxTradeVolume_, comptroller_);
    }

    function init(
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        IComptroller comptroller_
    ) public initializer {
        __Asset_init(erc20_, maxTradeVolume_);
        __CompoundOracleMixin_init(comptroller_);
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (uint192) {
        return consultOracle(erc20);
    }
}
