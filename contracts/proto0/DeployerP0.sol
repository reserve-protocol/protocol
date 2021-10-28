// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../Ownable.sol"; // temporary
// import "@openzeppelin/contracts/access/Ownable.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./assets/RTokenAssetP0.sol";
import "./assets/RSRAssetP0.sol";
import "./assets/COMPAssetP0.sol";
import "./assets/AAVEAssetP0.sol";
import "../libraries/CommonErrors.sol";
import "./libraries/Oracle.sol";
import "./interfaces/IAsset.sol";
import "./interfaces/IVault.sol";
import "./assets/RTokenAssetP0.sol";
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
        IComptroller compound,
        IAaveLendingPool aave,
        RSRAssetP0 rsrAsset,
        COMPAssetP0 compAsset,
        AAVEAssetP0 aaveAsset,
        IAsset[] memory approvedCollateralAssets
    ) external {
        Oracle.Info memory oracle = Oracle.Info(compound, aave);
        MainP0 main = new MainP0(owner, oracle, config, rsr);

        {
            DefaultMonitorP0 monitor = new DefaultMonitorP0(main);
            main.setMonitor(monitor);
        }

        {
            RTokenP0 rToken = new RTokenP0(main, name, symbol);
            main.setRToken(rToken);
            RTokenAssetP0 rTokenAsset = new RTokenAssetP0(address(rToken));
            main.setAssets(rTokenAsset, rsrAsset, compAsset, aaveAsset);
            FurnaceP0 furnace = new FurnaceP0(address(rToken));
            main.setFurnace(furnace);
        }

        {
            AssetManagerP0 manager = new AssetManagerP0(main, vault, owner, approvedCollateralAssets);
            main.setManager(manager);
        }

        {
            StakingPoolP0 staking = new StakingPoolP0(
                main,
                string(abi.encodePacked("Staked RSR - ", name)),
                string(abi.encodePacked("st", symbol, "RSR"))
            );
            main.setStakingPool(staking);
        }

        main.transferOwnership(owner);
    }
}
