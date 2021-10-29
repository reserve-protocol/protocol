// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

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
import "./StRSRP0.sol";

/**
 * @title DeployerP0
 * @dev The deployer for the entire system.
 */

struct ParamsAssets {
    RSRAssetP0 rsrAsset;
    COMPAssetP0 compAsset;
    AAVEAssetP0 aaveAsset;
}

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
        ParamsAssets memory assets,
        IAsset[] memory approvedCollateralAssets
    ) external returns (address) {
        Oracle.Info memory oracle = Oracle.Info(compound, aave);

        MainP0 main = new MainP0(oracle, config, rsr);

        {
            DefaultMonitorP0 monitor = new DefaultMonitorP0(main);
            main.setMonitor(monitor);
        }

        {
            RTokenP0 rToken = new RTokenP0(main, name, symbol);
            main.setRToken(rToken);
            RTokenAssetP0 rTokenAsset = new RTokenAssetP0(address(rToken));
            main.setAssets(rTokenAsset, assets.rsrAsset, assets.compAsset, assets.aaveAsset);
            FurnaceP0 furnace = new FurnaceP0(address(rToken));
            main.setFurnace(furnace);
        }

        {
            StRSRP0 stRSR = new StRSRP0(
                main,
                string(abi.encodePacked("Staked RSR - ", name)),
                string(abi.encodePacked("st", symbol, "RSR"))
            );
            main.setStRSR(stRSR);
        }

        {
            AssetManagerP0 manager = new AssetManagerP0(main, vault, owner, approvedCollateralAssets);
            main.setManager(manager);
        }
        main.transferOwnership(owner);

        return (address(main));
    }
}
