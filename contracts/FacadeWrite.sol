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

    constructor(IDeployer deployer_) {
        require(address(deployer_) != address(0), "invalid address");
        deployer = deployer_;
    }

    function deployRToken(ConfigurationParams calldata config, SetupParams calldata setup)
        external
        returns (address)
    {
        // Perform validations
        require(setup.primaryBasket.length > 0, "no collateral");
        require(setup.primaryBasket.length == setup.weights.length, "invalid length");

        // Validate backups
        for (uint256 i = 0; i < setup.backups.length; ++i) {
            require(setup.backups[i].backupCollateral.length > 0, "no backup collateral");
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

        // Unfreeze (required for next steps)
        main.unfreeze();

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

        // Freeze
        main.freeze();

        // Setup deployer as owner to complete next step - do not renounce roles yet
        main.grantRole(OWNER, msg.sender);

        // Return rToken address
        return address(rToken);
    }

    function setupGovernance(
        IRToken rToken,
        bool deployGovernance,
        bool unfreeze,
        GovernanceParams calldata govParams,
        address owner,
        address freezer,
        address pauser
    ) external returns (address) {
        // Get Main
        IMain main = rToken.main();

        require(main.hasRole(OWNER, address(this)), "ownership already transferred");
        require(main.hasRole(OWNER, msg.sender), "not initial deployer");

        // Remove ownership to sender
        main.revokeRole(OWNER, msg.sender);

        // New owner
        address newOwner;

        if (deployGovernance) {
            require(owner == address(0), "owner should be empty");

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

            // Setup new owner - Timelock
            newOwner = address(timelock);
        } else {
            require(owner != address(0), "owner not defined");

            newOwner = owner;
        }

        // Setup Freezer
        if (freezer != address(0)) {
            main.grantRole(FREEZER, freezer);
        }

        // Setup Pauser
        if (pauser != address(0)) {
            main.grantRole(PAUSER, pauser);
        }

        // Unfreeze if required
        if (unfreeze) {
            main.unfreeze();
        }

        // Transfer Ownership and renounce roles
        main.grantRole(OWNER, newOwner);
        main.grantRole(FREEZER, newOwner);
        main.grantRole(PAUSER, newOwner);
        main.renounceRole(OWNER, address(this));
        main.renounceRole(FREEZER, address(this));
        main.renounceRole(PAUSER, address(this));

        // Return new owner address
        return newOwner;
    }
}
