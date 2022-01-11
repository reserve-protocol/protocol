// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/interfaces/IRToken.sol";
import "contracts/p0/interfaces/IOracle.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title IExplorer
 * @notice A read-only layer on top of the protocol for use from off-chain.
 */
interface IExplorer {
    /// @return How many RToken `account` can issue given current holdings
    function maxIssuable(address account) external view returns (uint256);

    function currentBacking()
        external
        view
        returns (address[] memory tokens, uint256[] memory quantities);
}
