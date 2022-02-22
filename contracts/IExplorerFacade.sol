// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title IExplorerFacade
 * @notice A read-only layer on top of the protocol for use from an off-chain explorer.
 */
interface IExplorerFacade {
    function runAuctionsForAllTraders() external;

    function claimAndSweepRewardsForAllTraders() external;

    function doFurnaceMelting() external;

    function ensureValidBasket() external;

    /// @return How many RToken `account` can issue given current holdings
    function maxIssuable(address account) external view returns (uint256);

    function currentBacking()
        external
        view
        returns (address[] memory tokens, uint256[] memory quantities);
}
