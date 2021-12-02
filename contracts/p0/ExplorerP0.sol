// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IVault.sol";
import "contracts/p0/AssetManagerP0.sol";
import "contracts/p0/MainP0.sol";
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
        return main.manager().fromBUs(main.manager().vault().maxIssuable(account));
    }

    function currentBacking() external view override returns (address[] memory tokens, uint256[] memory quantities) {
        AssetManagerP0 manager = AssetManagerP0(address(main.manager()));
        tokens = manager.allAssetERC20s();
        quantities = new uint256[](tokens.length);

        // Add Vault contents
        for (uint256 j = 0; j < tokens.length; j++) {
            quantities[j] += IERC20(tokens[j]).balanceOf(address(manager.vault()));
        }

        // Add past vault contents
        for (uint256 i = 0; i < manager.numPastVaults(); i++) {
            IVault vault = manager.pastVaults(i);
            for (uint256 j = 0; j < tokens.length; j++) {
                quantities[j] += IERC20(tokens[j]).balanceOf(address(vault));
            }
        }

        // Add AssetManager contents
        for (uint256 i = 0; i < tokens.length; i++) {
            quantities[i] += IERC20(tokens[i]).balanceOf(address(manager));
        }
    }
}
