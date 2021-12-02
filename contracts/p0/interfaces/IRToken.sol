// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title IRToken
 * @notice An ERC20 with an elastic supply.
 * @dev The p0-specific IRToken
 */
interface IRToken is IERC20Metadata {
    /// Mints a quantity of RToken to the `recipient`, only callable by AssetManager
    /// @param recipient The recipient of the newly minted RToken
    /// @param amount {qTok} The amount to be minted
    /// @return true
    function mint(address recipient, uint256 amount) external returns (bool);

    /// Burns a quantity of RToken from the callers account
    /// @param from The account from which RToken should be burned
    /// @param amount {qTok} The amount to be burned
    /// @return true
    function burn(address from, uint256 amount) external returns (bool);

    /// Melts a quantity of RToken from the caller's account
    /// @param from The account from which RToken should be melted
    /// @param amount {qTok} The amount to be melted
    /// @return true
    function melt(address from, uint256 amount) external returns (bool);

    /// Main leverages the RToken to hold vesting issuance
    function withdrawTo(address to, uint256 amount) external;

    function setMain(address main) external;

    function main() external view returns (address);

    function totalMelted() external view returns (uint256);
}
