// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/IExplorerFacade.sol";
import "./IMain.sol";
import "./IRToken.sol";
import "./IStRSR.sol";

/**
 * @title IDeployer
 * @notice The deployer for the entire system.
 */
interface IDeployer {
    /// Emitted when a new RToken and accompanying system is deployed
    /// @param main The address of `Main`
    /// @param rToken The address of the RToken ERC20
    /// @param stRSR The address of the StRSR ERC20 staking pool/token
    /// @param facade The address of the view facade
    /// @param owner The owner of the newly deployed system
    event RTokenCreated(
        IMain indexed main,
        IRToken indexed rToken,
        IStRSR stRSR,
        IExplorerFacade facade,
        address indexed owner
    );

    //

    /// Deploys an instance of the entire system
    /// @param name The name of the RToken to deploy
    /// @param symbol The symbol of the RToken to deploy
    /// @param owner The address that should own the entire system, hopefully a governance contract
    /// @param config Governance param
    /// @param dist Shares of revenue initially to RSR pool and RToken melting
    /// @param maxAuctionSize {UoA} The max auction size to use for RToken/RSR/COMP/AAVE
    /// @return The address of the newly deployed Main instance.
    function deploy(
        string calldata name,
        string calldata symbol,
        address owner,
        Config calldata config,
        RevenueShare calldata dist,
        Fix maxAuctionSize
    ) external returns (address);
}
