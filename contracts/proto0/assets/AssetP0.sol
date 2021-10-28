// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IAsset.sol";
import "../interfaces/IMain.sol";

// Immutable data contract, extended to implement cToken and aToken wrappers.
contract AssetP0 is IAsset {
    uint256 public constant SCALE = 1e18;

    address internal immutable _erc20;

    constructor(address erc20_) {
        _erc20 = erc20_;
    }

    // Fiatcoins return 1e18. All redemption rates should have 18 zeroes.
    function redemptionRate() public view virtual override returns (uint256) {
        return 1e18;
    }

    function erc20() public view virtual override returns (IERC20) {
        return IERC20(_erc20);
    }

    function decimals() external view override returns (uint8) {
        return IERC20Metadata(_erc20).decimals();
    }

    function fiatcoinDecimals() public view override returns (uint8) {
        return IERC20Metadata(fiatcoin()).decimals();
    }

    function fiatcoin() public view virtual override returns (address) {
        return _erc20;
    }

    function priceUSD(IMain main) public view virtual override returns (uint256) {
        return (redemptionRate() * main.consultAaveOracle(address(erc20()))) / SCALE;
    }

    function fiatcoinPriceUSD(IMain main) public view virtual override returns (uint256) {
        return main.consultAaveOracle(fiatcoin());
    }

    function isFiatcoin() external pure virtual override returns (bool) {
        return true;
    }
}
