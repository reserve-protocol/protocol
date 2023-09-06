// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./IRToken.sol";
import "./IStRSR.sol";

/**
 * @title IFacadeTest
 * @notice A facade that is useful for driving/querying the system during testing
 *
 * - @custom:static-call - Use ethers callStatic() in order to get result after update
 * - @custom:view - Regular view
 */
interface IFacadeTest {
    /// Prompt all traders to run auctions
    /// @custom:interaction
    function runAuctionsForAllTraders(IRToken rToken) external;

    /// Prompt all traders and the RToken itself to claim rewards and sweep to BackingManager
    /// @custom:interaction
    function claimRewards(IRToken rToken) external;

    /// @return total {UoA} An estimate of the total value of all assets held at BackingManager
    /// @custom:static-call
    function totalAssetValue(IRToken rToken) external returns (uint192 total);

    /// @param account The account to count baskets for
    /// @return {BU} The number of basket units helds
    function wholeBasketsHeldBy(IRToken rToken, address account) external view returns (uint192);
}
