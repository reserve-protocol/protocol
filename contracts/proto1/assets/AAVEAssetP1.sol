// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/proto1/interfaces/IAssetP1.sol";
import "contracts/proto1/interfaces/IMainP1.sol";
import "contracts/proto1/libraries/OracleP1.sol";
import "contracts/libraries/Fixed.sol";

contract AAVEAssetP1 is IAssetP1 {
    using FixLib for Fix;

    address internal immutable _erc20;

    constructor(address erc20_) {
        _erc20 = erc20_;
    }

    // @return {attoUSD/qAAVE}
    function priceUSD(IMainP1 main) public view override returns (Fix) {
        return main.consultOracle(Oracle.Source.AAVE, _erc20);
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
