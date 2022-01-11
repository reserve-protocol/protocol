// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/libraries/Fixed.sol";
import "./Asset.sol";

contract RTokenAssetP0 is AssetP0 {
    using FixLib for Fix;

    // TODO UoA may not make sense here, re-examine later
    constructor(IERC20Metadata erc20_, IMain main_)
        AssetP0(UoA.USD, erc20_, main_, Oracle.Source.AAVE)
    {}

    /// @return {attoUoA/qRTok}
    function price(UoA uoa_) public view override returns (Fix) {
        require(uoa == uoa_, "conversions across units of account not implemented yet");
        return
            main.vault().basketPrice(uoa_).mul(main.baseFactor()).shiftLeft(
                -int8(main.vault().BU_DECIMALS())
            );
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() public pure virtual override returns (bool) {
        return false;
    }
}
