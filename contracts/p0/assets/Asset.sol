// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IOracle.sol";
import "contracts/libraries/Fixed.sol";

contract AssetP0 is IAsset, Context {
    using FixLib for Fix;

    UoA public immutable override uoa; // Unit of Account
    IERC20Metadata public immutable override erc20;
    IMain public immutable main;
    IOracle public override oracle;

    constructor(
        UoA uoa_,
        IERC20Metadata erc20_,
        IMain main_,
        IOracle oracle_
    ) {
        uoa = uoa_;
        erc20 = erc20_;
        main = main_;
        oracle = oracle_;
    }

    /// @return {attoUSD/qTok} The attoUSD price of 1 qToken
    function price() public view virtual override returns (Fix) {
        return oracle.consult(erc20).shiftLeft(-int8(erc20.decimals()));
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() public pure virtual override returns (bool) {
        return false;
    }

    function setOracle(IOracle newOracle) external {
        require(_msgSender() == main.owner(), "only main.owner");
        oracle = newOracle;
    }
}
