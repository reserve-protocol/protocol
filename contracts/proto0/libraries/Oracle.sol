// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

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

library Oracle {
    struct Info {
        IComptroller compound;
        IAaveLendingPool aave;
    }

    // Returns the USD price with 18 decimals
    function consultAave(Oracle.Info storage self, address token) public view returns (uint256) {
        // Aave keeps their prices in terms of ETH
        IAaveOracle aaveOracle = self.aave.getAddressesProvider().getPriceOracle();
        uint256 inETH = aaveOracle.getAssetPrice(token);
        uint256 ethNorm = aaveOracle.getAssetPrice(aaveOracle.WETH());
        uint256 ethInUsd = self.compound.oracle().price("ETH");
        return (inETH * ethInUsd * 10**12) / ethNorm;
    }

    // Returns the USD price with 18 decimals
    function consultCompound(Oracle.Info storage self, address token) public view returns (uint256) {
        return self.compound.oracle().price(IERC20Metadata(token).symbol()) * 10**12;
    }
}
