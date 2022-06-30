// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IDeployer.sol";
import "contracts/interfaces/IFacadeWrite.sol";
import "contracts/interfaces/IMain.sol";

/**
 * @title FacadeWrite
 * @notice A UX-friendly layer to interact with the protocol
 */
contract FacadeWrite is IFacadeWrite {
    IDeployer public immutable deployer;

    constructor(IDeployer deployer_) {
        deployer = deployer_;
    }

    function deployRToken(
        ConfigurationParams calldata config,
        SetupParams calldata setup,
        address owner
    ) external returns (address) {
        // Perform validations
        require(setup.primaryBasket.length > 0, "No collateral");
        require(setup.primaryBasket.length == setup.weights.length, "Invalid length");

        // Validate backups
        for (uint256 i = 0; i < setup.backups.length; ++i) {
            require(setup.backups[i].backupCollateral.length > 0, "No backup collateral");
        }

        // Deploy contracts
        IMain main = IMain(
            deployer.deploy(
                config.name,
                config.symbol,
                config.manifestoURI,
                address(this), // set as owner
                config.params
            )
        );

        // Register reward assets
        for (uint256 i = 0; i < setup.rewardAssets.length; ++i) {
            IAssetRegistry(address(main.assetRegistry())).register(setup.rewardAssets[i]);
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

        // Pause (required for next steps)
        main.pause();

        // Transfer Ownership
        main.setOneshotPauser(owner);
        main.transferOwnership(owner);

        // Return main address
        return address(main);
    }
}
