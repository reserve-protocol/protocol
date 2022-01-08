// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/libraries/Pricing.sol";
import "contracts/libraries/CommonErrors.sol";
import "contracts/libraries/Fixed.sol";

interface IComptroller {
    function oracle() external view returns (ICompoundOracle);

    function claimComp(address holder) external;
}

interface ICompoundOracle {
    /// @return {microUSD/tok} The USD price of the corresponding token with 6 decimals.
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
    // solhint-disable-next-line func-name-mixedcase
    function WETH() external view returns (address);

    /// @return {qETH/tok} The price of the `token` in ETH with 18 decimals
    function getAssetPrice(address token) external view returns (uint256);
}

// TODO: Adapt oracles for multiple UoAs. Right now this is just a USD oracle
library Oracle {
    using FixLib for Fix;
    using PricingLib for Price;

    enum Source {
        AAVE,
        COMPOUND
    }

    struct Info {
        IComptroller compound;
        IAaveLendingPool aave;
    }

    /// @return p {attoPrice/tok} The Price of a whole token on oracle `source`
    function consult(
        Oracle.Info memory self,
        Source source,
        IERC20Metadata erc20
    ) internal view returns (Price memory p) {
        if (source == Source.AAVE) {
            p.setUSD(_consultAave(self, erc20));
        } else if (source == Source.COMPOUND) {
            p.setUSD(_consultCompound(self, erc20));
        } else {
            revert CommonErrors.UnsupportedProtocol();
        }
    }

    /// @return {attoUSD/tok}
    function _consultAave(Oracle.Info memory self, IERC20Metadata erc20)
        private
        view
        returns (Fix)
    {
        // Aave keeps their prices in terms of ETH
        IAaveOracle aaveOracle = self.aave.getAddressesProvider().getPriceOracle();
        uint256 p = aaveOracle.getAssetPrice(address(erc20));

        if (p == 0) {
            revert CommonErrors.PriceIsZero(erc20.symbol());
        }

        Fix inETH = toFix(p); // {qETH/tok}
        Fix ethNorm = toFix(aaveOracle.getAssetPrice(aaveOracle.WETH())); // {qETH/ETH}
        Fix ethInUsd = toFix(self.compound.oracle().price("ETH")); // {microUSD/ETH}

        // {qETH/tok} * {microUSD/ETH} / {qETH/ETH} * {attoUSD/microUSD}
        return inETH.mul(ethInUsd).div(ethNorm).shiftLeft(12);
    }

    /// @return {attoUSD/tok}
    function _consultCompound(Oracle.Info memory self, IERC20Metadata erc20)
        private
        view
        returns (Fix)
    {
        // Compound stores prices with 6 decimals of precision

        uint256 p = self.compound.oracle().price(erc20.symbol());
        if (p == 0) {
            revert CommonErrors.PriceIsZero(erc20.symbol());
        }

        // {microUSD/tok} * {attoUSD/microUSD}
        return toFix(p).shiftLeft(12);
    }
}
