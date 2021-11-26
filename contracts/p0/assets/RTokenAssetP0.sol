// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IVault.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/libraries/Fixed.sol";

contract RTokenAssetP0 is IAsset {
    using FixLib for Fix;

    address internal immutable _erc20;

    constructor(address erc20_) {
        _erc20 = erc20_;
    }

    /// @return {attoUSD/qRTok}
    function priceUSD(IMain main) public view override returns (Fix) {
        Fix sum; // {attoUSD/BU}
        IVault v = main.manager().vault();
        for (uint256 i = 0; i < v.size(); i++) {
            ICollateral c = v.collateralAt(i);

            // {attoUSD/BU} = {attoUSD/BU} + {attoUSD/qTok} * {qTok/BU}
            sum = sum.plus(c.priceUSD(main).mulu(v.quantity(c)));
        }

        // {attoUSD/qBU} = {attoUSD/BU} / {qBU/BU}
        Fix perQBU = sum.divu(10**v.BU_DECIMALS());

        // {attoUSD/qRTok} = {attoUSD/qBU} * {qBU/qRTok}
        return perQBU.mul(main.manager().baseFactor());
    }

    /// @return The ERC20 contract of the central token
    function erc20() public view virtual override returns (IERC20) {
        return IERC20(_erc20);
    }

    /// @return The number of decimals in the central token
    function decimals() public view override returns (uint8) {
        return IERC20Metadata(_erc20).decimals();
    }
}
