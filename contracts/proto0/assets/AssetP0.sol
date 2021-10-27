// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../interfaces/IAsset.sol";
import "../libraries/Oracle.sol";

// Immutable data contract, extended to implement cToken and aToken wrappers.
contract AssetP0 is IAsset {
    using Oracle for Oracle.Info;

    uint256 public constant SCALE = 1e18;

    address internal immutable _erc20;

    Oracle.Info internal _oracle;

    constructor(address erc20_, Oracle.Info memory oracle_) {
        _erc20 = erc20_;
        _oracle = oracle_;
    }

    // Fiatcoins return 1e18. All redemption rates should have 18 zeroes.
    function redemptionRate() external view virtual override returns (uint256) {
        return 1e18;
    }

    function erc20() external view override returns (address) {
        return _erc20;
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

    function priceUSD() public view virtual override returns (uint256) {
        return (redemptionRate() * _oracle.consultAave(erc20())) / SCALE;
    }

    function fiatcoinPriceUSD() public view virtual override returns (uint256) {
        return _oracle.consultAave(fiatcoin());
    }

    function isFiatcoin() external pure virtual override returns (bool) {
        return true;
    }
}
