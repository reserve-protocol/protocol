// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IOracle.sol";
import "contracts/libraries/Fixed.sol";
import "./Asset.sol";

contract RTokenAssetP0 is AssetP0 {
    using FixLib for Fix;

    // TODO UoA may not make sense here, re-examine later
    // solhint-disable no-empty-blocks
    constructor(
        IERC20Metadata erc20_,
        IMain main_,
        IOracle oracle_
    ) AssetP0(UoA.USD, erc20_, main_, oracle_) {}

    // solhint-enable no-empty-blocks

    /// @return {attoUSD/qRTok}
    function price() public view override returns (Fix) {
        return
            main.vault().basketPrice(uoa).mul(main.baseFactor()).shiftLeft(
                -int8(main.vault().BU_DECIMALS())
            );
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() public pure virtual override returns (bool) {
        return false;
    }
}
