// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IDeployer.sol";
import "contracts/interfaces/IFacadeWrite.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IRToken.sol";

import "@openzeppelin/contracts/governance/TimelockController.sol";
import "contracts/plugins/governance/Governance.sol";

/**
 * @title FacadeWrite
 * @notice A UX-friendly layer to interact with the protocol
 */
contract FacadeWrite is IFacadeWrite {
    IDeployer public immutable deployer;

    // Track the deployer and status for each RToken
    mapping(address => address) public deployers;

    constructor(IDeployer deployer_) {
        deployer = deployer_;
    }

    function deployRToken(ConfigurationParams calldata config, SetupParams calldata setup)
        external
        returns (address)
    {
        // Perform validations
        require(setup.primaryBasket.length > 0, "No collateral");
        require(setup.primaryBasket.length == setup.weights.length, "Invalid length");

        // Validate backups
        for (uint256 i = 0; i < setup.backups.length; ++i) {
            require(setup.backups[i].backupCollateral.length > 0, "No backup collateral");
        }

        // Deploy contracts
        IRToken rToken = IRToken(
            deployer.deploy(
                config.name,
                config.symbol,
                config.manifestoURI,
                address(this), // set as owner
                config.params
            )
        );

        // Get Main
        IMain main = rToken.main();

        // Register assets
        for (uint256 i = 0; i < setup.assets.length; ++i) {
            IAssetRegistry(address(main.assetRegistry())).register(setup.assets[i]);
        }

        // Unpause (required for next steps)
        main.unpause();

        // Setup basket
        {
            IERC20[] memory basketERC20s = new IERC20[](setup.primaryBasket.length);

            // Register collateral
            for (uint256 i = 0; i < setup.primaryBasket.length; ++i) {
                IAssetRegistry(address(main.assetRegistry())).register(setup.primaryBasket[i]);
                IERC20 erc20 = setup.primaryBasket[i].erc20();
                basketERC20s[i] = erc20;

                // Grant allowance
                main.backingManager().grantRTokenAllowance(erc20);
            }

            // Set basket
            main.basketHandler().setPrimeBasket(basketERC20s, setup.weights);
            main.basketHandler().refreshBasket();
        }

        // Set backup config
        {
            for (uint256 i = 0; i < setup.backups.length; ++i) {
                IERC20[] memory backupERC20s = new IERC20[](
                    setup.backups[i].backupCollateral.length
                );

                for (uint256 j = 0; j < setup.backups[i].backupCollateral.length; ++j) {
                    ICollateral backupColl = setup.backups[i].backupCollateral[j];
                    IAssetRegistry(address(main.assetRegistry())).register(backupColl);
                    backupERC20s[j] = backupColl.erc20();
                }

                main.basketHandler().setBackupConfig(
                    setup.backups[i].backupUnit,
                    setup.backups[i].diversityFactor,
                    backupERC20s
                );
            }
        }

        // Pause
        main.pause();

        // Setup deployer address
        deployers[address(rToken)] = msg.sender;

        // Return rToken address
        return address(rToken);
    }

    function setupGovernance(
        IRToken rToken,
        bool deployGovernance,
        bool unpause,
        GovernanceParams calldata govParams,
        address owner,
        address pauser
    ) external returns (address) {
        require(deployers[address(rToken)] == msg.sender, "Not initial deployer");

        // Get Main
        IMain main = rToken.main();

        require(main.owner() == address(this), "Ownership already transferred");

        // Final owner
        address transferOwnershipTo;

        if (deployGovernance) {
            require(owner == address(0), "Owner defined");

            // Deploy Governance
            TimelockController timelock = new TimelockController(
                govParams.minDelay,
                new address[](0),
                new address[](0)
            );
            Governance governance = new Governance(
                IStRSRVotes(address(main.stRSR())),
                timelock,
                govParams.votingDelay,
                govParams.votingPeriod,
                govParams.proposalThresholdAsMicroPercent,
                govParams.quorumPercent
            );

            // Emit event
            emit GovernanceCreated(rToken, address(governance), address(timelock));

            // Setup Roles
            timelock.grantRole(timelock.PROPOSER_ROLE(), address(governance)); // Gov only proposer
            timelock.grantRole(timelock.EXECUTOR_ROLE(), address(0)); // Anyone as executor
            timelock.revokeRole(timelock.TIMELOCK_ADMIN_ROLE(), address(this)); // Revoke admin role

            // Setup owner - Timelock
            transferOwnershipTo = address(timelock);
        } else {
            require(owner != address(0), "Owner not defined");

            transferOwnershipTo = owner;
        }

        // Unpause
        if (unpause) {
            main.unpause();
        }

        // Setup Pauser
        if (pauser != address(0)) {
            main.setOneshotPauser(pauser);
        } else {
            main.setOneshotPauser(transferOwnershipTo);
        }
        // Transfer Ownership
        main.transferOwnership(transferOwnershipTo);

        // Return owner address
        return transferOwnershipTo;
    }
}
