// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/draft-IERC20Permit.sol";
import "contracts/p0/interfaces/IMain.sol";

/**
 * @title IRToken
 * @notice An ERC20 with an elastic supply.
 * @dev The p0-specific IRToken
 */
interface IRToken is IERC20Metadata, IERC20Permit {
    /// Emitted when Main is set
    /// @param oldMain The old address of Main
    /// @param newMain The new address of Main
    event MainSet(IMain indexed oldMain, IMain indexed newMain);

    /// Mints a quantity of RToken to the `recipient`, only callable by AssetManager
    /// @param recipient The recipient of the newly minted RToken
    /// @param amount {qRTok} The amount to be minted
    /// @return true
    function mint(address recipient, uint256 amount) external returns (bool);

    /// Burns a quantity of RToken from the callers account
    /// @param from The account from which RToken should be burned
    /// @param amount {qRTok} The amount to be burned
    /// @return true
    function burn(address from, uint256 amount) external returns (bool);

    /// Withdraws a quantity of RToken from the RToken itself
    /// @param to The address to send the tokens to
    /// @param amount {qRTok} The amount to be withdrawn
    function withdraw(address to, uint256 amount) external;

    function setMain(IMain main) external;
}
