// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/Main.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/IExplorer.sol";

/**
 * @title ExplorerP0
 * @notice A read-only layer on top of the protocol for use from off-chain.
 */
contract ExplorerP0 is IExplorer {
    MainP0 public main;

    constructor(address main_) {
        main = MainP0(main_);
    }

    /// @return How many RToken `account` can issue given current holdings
    function maxIssuable(address account) external view override returns (uint256) {
        return main.fromBUs(main.maxIssuable(account));
    }

    function currentBacking()
        external
        view
        override
        returns (address[] memory tokens, uint256[] memory quantities)
    {
        IAsset[] memory assets = main.allAssets();
        tokens = new address[](assets.length);
        quantities = new uint256[](tokens.length);

        // Convert IAsset to ERC20 address
        for (uint256 j = 0; j < assets.length; j++) {
            tokens[j] = address(assets[j].erc20());
            quantities[j] += assets[j].erc20().balanceOf(address(main.vault()));
        }

        // Add vaults contents
        for (uint256 i = 0; i < main.numVaults(); i++) {
            // TODO after vault destruction
            // IVault vault = main.vaults(i);
            // for (uint256 j = 0; j < tokens.length; j++) {
            //     quantities[j] += IERC20(tokens[j]).balanceOf(address(vault));
            // }
        }

        // Add BackingTrader contents
        for (uint256 i = 0; i < tokens.length; i++) {
            quantities[i] += IERC20(tokens[i]).balanceOf(address(main.backingTrader()));
        }
    }
}
