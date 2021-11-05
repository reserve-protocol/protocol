// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/libraries/Fixed.sol";

interface IComptroller {
    function oracle() external view returns (ICompoundOracle);

    function claimComp(address holder) external;
}

interface ICompoundOracle {
    /// @return {USD_q6} The USD price of the corresponding token with 6 decimals.
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

    /// @return {qETH/tok} The price of the `token` in ETH with 18 decimals
    function getAssetPrice(address token) external view returns (uint256);
}

library Oracle {
    using FixLib for Fix;

    struct Info {
        IComptroller compound;
        IAaveLendingPool aave;
    }

    /// Returns {attoUSD/tok} price of the `token` based on Aave oracles
    function consultAave(Oracle.Info storage self, address token) internal view returns (Fix) {
        // Aave keeps their prices in terms of ETH
        IAaveOracle aaveOracle = self.aave.getAddressesProvider().getPriceOracle();
        Fix inETH = toFix(aaveOracle.getAssetPrice(token)); // {qETH/tok}
        Fix ethNorm = toFix(aaveOracle.getAssetPrice(aaveOracle.WETH())); // {qETH/wholeETH}
        Fix ethInUsd = toFix(self.compound.oracle().price("ETH")).divu(1e6); // {USD_6/wholeETH} / {USD_6/USD}

        // ({qETH/tok} * {USD/wholeETH} * {attoUSD/USD}) / {qETH/wholeETH}
        return inETH.mul(ethInUsd).mul(toFix(1e18).div(ethNorm));
    }

    /// Returns {attoUSD/tok} price of the `token` based on compound oracles
    function consultCompound(Oracle.Info storage self, address token) internal view returns (Fix) {
        // Compound stores prices with 6 decimals of precision

        // ({USD_6/tok} * {attoUSD/USD})/ {USD_6/USD}
        return toFix(self.compound.oracle().price(IERC20Metadata(token).symbol())).mulu(1e12);
    }
}
