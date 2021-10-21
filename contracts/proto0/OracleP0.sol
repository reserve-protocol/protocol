// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "./interfaces/ICollateral.sol";
import "./interfaces/IOracle.sol";

interface Comptroller {
    function oracle() external view returns (CompoundOracle);
}

interface CompoundOracle {
    function price(string memory symbol) external view returns (uint256);
}

//

interface AaveLendingPool {
    function getAddressesProvider() external view returns (ILendingPoolAddressesProvider);
}

interface ILendingPoolAddressesProvider {
    function getPriceOracle() external view returns (AaveOracle);
}

interface AaveOracle {
    function WETH() external view returns (address);
    function getAssetPrice(address oracle) external view returns (uint256);
}

contract OracleP0 is IOracle {

    uint256 constant padding = 10**12;
    
    Comptroller public compound;
    AaveLendingPool public aave;

    constructor(address comptrollerAddress, address aaveLendingPoolAddress) {
        compound = Comptroller(comptrollerAddress);
        aave = AaveLendingPool(aaveLendingPoolAddress);
    }

    // Returns the USD price using 18 decimals
    function fiatcoinPrice(ICollateral collateral) external view override returns (uint256) {
        if (keccak256(bytes(collateral.oracle())) == keccak256("AAVE")) {
            return consultAAVE(collateral.fiatcoin());
        } else if (keccak256(bytes(collateral.oracle())) == keccak256("COMP")) {
            return consultCOMP(collateral.fiatcoin());
        }
        assert(false);
    }

    // Returns the USD price using 18 decimals
    function consultAAVE(address token) public view override returns (uint256) {
        // Aave keeps their prices in terms of ETH
        AaveOracle aaveOracle = aave.getAddressesProvider().getPriceOracle();
        uint256 inETH = aaveOracle.getAssetPrice(token);
        uint256 ethNorm = aaveOracle.getAssetPrice(aaveOracle.WETH());
        uint256 ethInUsd = compound.oracle().price("ETH");
        return inETH * ethInUsd * padding / ethNorm;        
    }

    // Returns the USD price using 18 decimals
    function consultCOMP(address token) public view override returns (uint256) {
        return compound.oracle().price(IERC20Metadata(token).symbol()) * padding;
    }
}
