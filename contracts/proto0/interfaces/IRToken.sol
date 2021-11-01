// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title RTokenP0
 * @notice An ERC20 with an elastic supply.
 */
interface IRToken is IERC20Metadata {
    /// @notice Mints a quantity of RToken to the `recipient`, only callable by AssetManager
    /// @param recipient The recipient of the newly minted RToken
    /// @param amount The amount to be minted {qRToken}
    /// @return true
    function mint(address recipient, uint256 amount) external returns (bool);

    /// @notice Burns a quantity of RToken from an account, only callable by AssetManager or `from`
    /// @param from The account from which RToken should be burned
    /// @param amount The amount to be burned {qRToken}
    /// @return true
    function burn(address from, uint256 amount) external returns (bool);
}
