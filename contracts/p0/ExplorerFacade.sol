// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/Main.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/IExplorerFacade.sol";

/**
 * @title ExplorerFacadeP0
 * @notice A read-only layer on top of the protocol for use from off-chain.
 */
contract ExplorerFacadeP0 is IExplorerFacade {
    MainP0 public main;

    constructor(address main_) {
        main = MainP0(main_);
    }

    /// @return How many RToken `account` can issue given current holdings
    function maxIssuable(address account) external view override returns (uint256) {
        return main.maxIssuable(account);
    }

    function currentBacking()
        external
        view
        override
        returns (address[] memory tokens, uint256[] memory quantities)
    {
        ICollateral[] memory collateral = main.basketCollateral();
        tokens = new address[](collateral.length);
        quantities = new uint256[](tokens.length);

        // Convert Collateral to ERC20
        for (uint256 j = 0; j < collateral.length; j++) {
            tokens[j] = address(collateral[j].erc20());
            quantities[j] += collateral[j].erc20().balanceOf(address(main));
        }
    }
}
