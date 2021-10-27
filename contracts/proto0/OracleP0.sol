// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "./interfaces/ICollateral.sol";
import "./interfaces/IOracle.sol";

interface IComptroller {
    function oracle() external view returns (ICompoundOracle);

    function claimComp(address holder) external;
}

interface ICompoundOracle {
    function price(string memory symbol) external view returns (uint256);
}

//

interface IAaveLendingPool {
    function getAddressesProvider() external view returns (ILendingPoolAddressesProvider);
}

interface ILendingPoolAddressesProvider {
    function getPriceOracle() external view returns (IAaveOracle);
}

interface IAaveOracle {
    function WETH() external view returns (address);

    function getAssetPrice(address oracle) external view returns (uint256);
}

/*
 * @title OracleP0
 * @dev A very simple oracle that delegates to the Compound or Aave oracles.
 */
contract OracleP0 is IOracle {
    uint256 constant padding = 10**12;

    IComptroller public compound;
    IAaveLendingPool public aave;

    constructor(address comptrollerAddress, address aaveLendingPoolAddress) {
        compound = IComptroller(comptrollerAddress);
        aave = IAaveLendingPool(aaveLendingPoolAddress);
    }

    // Returns the USD price using 18 decimals
    function fiatcoinPrice(ICollateral collateral) external view override returns (uint256) {
        if (keccak256(bytes(collateral.oracle())) == keccak256("AAVE")) {
            return consultAave(collateral.fiatcoin());
        } else if (keccak256(bytes(collateral.oracle())) == keccak256("COMP")) {
            return consultCompound(collateral.fiatcoin());
        }
        assert(false);
        return 0;
    }

    // Returns the USD price using 18 decimals
    function consultAave(address token) public view override returns (uint256) {
        // Aave keeps their prices in terms of ETH
        IAaveOracle aaveOracle = aave.getAddressesProvider().getPriceOracle();
        uint256 inETH = aaveOracle.getAssetPrice(token);
        uint256 ethNorm = aaveOracle.getAssetPrice(aaveOracle.WETH());
        uint256 ethInUsd = compound.oracle().price("ETH");
        return (inETH * ethInUsd * padding) / ethNorm;
    }

    // Returns the USD price using 18 decimals
    function consultCompound(address token) public view override returns (uint256) {
        return compound.oracle().price(IERC20Metadata(token).symbol()) * padding;
    }
}
