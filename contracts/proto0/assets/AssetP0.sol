// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IAsset.sol";
import "../interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title AssetP0
 * @notice A vanilla asset such as a fiatcoin, to be extended by more complex assets such as cTokens.
 */
contract AssetP0 is IAsset {
    uint256 public constant SCALE = 1e18;

    address internal immutable _erc20;

    constructor(address erc20_) {
        _erc20 = erc20_;
    }

    /// @notice Forces an update in asset's underlying DeFi protocol
    function updateRedemptionRate() external virtual override {}

    /// @dev `updateRedemptionRate()` before to ensure the latest rates
    /// @return The latest fiatcoin redemption rate
    function redemptionRate() public view virtual override returns (uint256) {
        return 1e18;
    }

    /// @return The ERC20 contract of the central token
    function erc20() public view virtual override returns (IERC20) {
        return IERC20(_erc20);
    }

    /// @return The number of decimals in the central token
    function decimals() external view override returns (uint8) {
        return IERC20Metadata(_erc20).decimals();
    }

    /// @return The number of decimals in the nested fiatcoin contract (or for the erc20 itself if it is a fiatcoin)
    function fiatcoinDecimals() public view override returns (uint8) {
        return IERC20Metadata(fiatcoin()).decimals();
    }

    /// @return The fiatcoin underlying the ERC20, or the erc20 itself if it is a fiatcoin
    function fiatcoin() public view virtual override returns (address) {
        return _erc20;
    }

    /// @return The price in USD of the asset as a function of DeFi redemption rates + oracle data
    function priceUSD(IMain main) public view virtual override returns (uint256) {
        // Aave has all 4 of the fiatcoins we are considering
        return (redemptionRate() * main.consultAaveOracle(address(erc20()))) / SCALE;
    }

    /// @return The price in USD of the fiatcoin underlying the ERC20 (or the price of the ERC20 itself)
    function fiatcoinPriceUSD(IMain main) public view virtual override returns (uint256) {
        return main.consultAaveOracle(fiatcoin());
    }

    /// @return Whether the asset is (directly) a fiatcoin
    function isFiatcoin() external pure virtual override returns (bool) {
        return true;
    }
}
