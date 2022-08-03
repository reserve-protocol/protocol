// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/interfaces/IDeployer.sol";
import "contracts/interfaces/IFacadeWrite.sol";
import "./FacadeWrite2.sol";

/**
 * @title FacadeWrite
 * @notice A UX-friendly layer to interact with the protocol
 * @dev Under the hood, uses two external libs to deal with blocksize limits.
 */
contract FacadeWrite is IFacadeWrite {
    IDeployer public immutable deployer;

    constructor(IDeployer deployer_) {
        require(address(deployer_) != address(0), "invalid address");
        deployer = deployer_;
    }

    /// Step 1
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

        // Freeze (+ regrant)
        main.freeze();
        main.grantRole(FREEZE_STARTER, address(this));

        // Setup deployer as owner to complete next step - do not renounce roles yet
        main.grantRole(OWNER, msg.sender);

        // Return rToken address
        return address(rToken);
    }

    /// Step 2
    function setupGovernance(
        IRToken rToken,
        bool deployGovernance,
        bool unfreeze,
        GovernanceParams calldata govParams,
        address owner,
        address guardian,
        address pauser
    ) external returns (address) {
        return
            FacadeWrite2.setupGovernance(
                rToken,
                deployGovernance,
                unfreeze,
                govParams,
                owner,
                guardian,
                pauser
            );
    }
}
