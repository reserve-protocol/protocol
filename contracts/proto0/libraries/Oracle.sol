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

    enum Source {
        AAVE,
        COMPOUND
    }

    struct Info {
        IComptroller compound;
        IAaveLendingPool aave;
    }

    function consult(
        Oracle.Info storage self,
        Source source,
        address token
    ) internal view returns (Fix) {
        if (source == Source.AAVE) {
            // Aave keeps their prices in terms of ETH

            IAaveOracle aaveOracle = self.aave.getAddressesProvider().getPriceOracle();
            uint256 p = aaveOracle.getAssetPrice(token);
            assert(p > 0);

            Fix inETH = toFix(p); // {qETH/tok}
            Fix ethNorm = toFix(aaveOracle.getAssetPrice(aaveOracle.WETH())); // {qETH/wholeETH}
            Fix ethInUsd = toFix(self.compound.oracle().price("ETH")).divu(1e6); // {USD_6/wholeETH} / {USD_6/USD}

            // ({qETH/tok} * {USD/wholeETH} * {attoUSD/USD}) / {qETH/wholeETH}
            return inETH.mul(ethInUsd).mul(toFix(1e18).div(ethNorm));
        } else if (source == Source.COMPOUND) {
            // Compound stores prices with 6 decimals of precision

            uint256 price = self.compound.oracle().price(IERC20Metadata(token).symbol());
            assert(price > 0);

            // ({USD_6/tok} * {attoUSD/USD})/ {USD_6/USD}
            return toFix(price).mulu(1e12);
        } else {
            assert(false);
        }
    }
}
