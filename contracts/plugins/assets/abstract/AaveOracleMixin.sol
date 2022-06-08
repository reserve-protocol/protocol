// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/abstract/CompoundOracleMixin.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/libraries/Fixed.sol";

// ==== External Interfaces ====
// See: https://github.com/aave/protocol-v2/tree/master/contracts/interfaces
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

// ==== End External Interfaces ====

abstract contract AaveOracleMixin is CompoundOracleMixin {
    IAaveLendingPool public aaveLendingPool;

    // solhint-disable-next-line func-name-mixedcase
    constructor(IComptroller comptroller_, IAaveLendingPool aaveLendingPool_)
        CompoundOracleMixin(comptroller_)
    {
        aaveLendingPool = aaveLendingPool_;
    }

    /// @return price_ {UoA/erc20}
    function consultOracle(IERC20Metadata erc20_) public view override returns (uint192 price_) {
        // Aave keeps their prices in terms of ETH
        IAaveOracle aaveOracle = aaveLendingPool.getAddressesProvider().getPriceOracle();
        uint256 p = aaveOracle.getAssetPrice(address(erc20_));
        uint256 ethPrice = comptroller.oracle().price("ETH"); // {microUoA/ETH}
        uint256 ethNorm = aaveOracle.getAssetPrice(aaveOracle.WETH()); // {qETH/ETH}

        // D18{UoA/erc20} = {qETH/erc20} * {microUoA/ETH} / {qETH/ETH} / {microUoA/UoA}
        price_ = uint192(mulDiv256(p, FIX_ONE * ethPrice, ethNorm, ROUND) / 1e6);

        if (price_ == 0) {
            revert PriceIsZero();
        }
    }
}
