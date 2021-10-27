// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../Ownable.sol"; // temporary
// import "@openzeppelin/contracts/access/Ownable.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../libraries/CommonErrors.sol";
import "./interfaces/IAsset.sol";
import "./interfaces/IVault.sol";
import "./AssetManagerP0.sol";
import "./DefaultMonitorP0.sol";
import "./FurnaceP0.sol";
import "./MainP0.sol";
import "./RTokenP0.sol";
import "./StakingPoolP0.sol";

/**
 * @title DeployerP0
 * @dev The deployer for the entire system.
 */
contract DeployerP0 {
    function deploy(
        string memory name,
        string memory symbol,
        address owner,
        IVault vault,
        IERC20 rsr,
        Config memory config,
        IAsset[] memory approvedAssets
    ) external {
        FurnaceP0 furnace = new FurnaceP0(address(rToken));
        MainP0 main = new MainP0(owner, config, rsr, furnace);

        DefaultMonitorP0 defaultMonitor = new DefaultMonitorP0(main);
        RTokenP0 rToken = new RTokenP0(main, name, symbol);
        AssetManagerP0 assetManager = new AssetManagerP0(main, vault, owner, approvedAssets);
        StakingPoolP0 staking = new StakingPoolP0(
            main,
            string(abi.encodePacked("Staked RSR - ", name)),
            string(abi.encodePacked("st", symbol, "RSR"))
        );
        main.setRToken(rToken);
        main.setManager(assetManager);
        main.setStakingPool(staking);
        main.transferOwnership(owner);
    }
}
