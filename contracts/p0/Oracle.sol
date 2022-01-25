// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/p0/interfaces/IOracle.sol";
import "contracts/libraries/CommonErrors.sol";
import "contracts/libraries/Fixed.sol";

contract CompoundOracle is IOracle {
    using FixLib for Fix;

    IComptroller public immutable override comptroller;

    constructor(IComptroller comptroller_) {
        comptroller = comptroller_;
    }

    /// @return {attoUSD/tok} The attoUSD price of a whole token on the compound oracle
    function consult(IERC20Metadata erc20) external view virtual override returns (Fix) {
        // Compound stores prices with 6 decimals of precision

        uint256 p = comptroller.oracle().price(erc20.symbol());
        if (p == 0) {
            revert CommonErrors.PriceIsZero(erc20.symbol());
        }

        // {microUSD/tok} * {attoUSD/microUSD}
        return toFix(p).shiftLeft(12);
    }
}

contract AaveOracle is CompoundOracle {
    using FixLib for Fix;

    IAaveLendingPool public immutable aaveLendingPool;

    constructor(IComptroller comptroller_, IAaveLendingPool aaveLendingPool_)
        CompoundOracle(comptroller_)
    {
        aaveLendingPool = aaveLendingPool_;
    }

    /// @return {attoUSD/tok} The attoUSD price of a whole token on the Aave oracle
    function consult(IERC20Metadata erc20) external view virtual override returns (Fix) {
        // Aave keeps their prices in terms of ETH
        IAaveOracle aaveOracle = aaveLendingPool.getAddressesProvider().getPriceOracle();
        uint256 p = aaveOracle.getAssetPrice(address(erc20));

        if (p == 0) {
            revert CommonErrors.PriceIsZero(erc20.symbol());
        }

        Fix inETH = toFix(p); // {qETH/tok}
        Fix ethNorm = toFix(aaveOracle.getAssetPrice(aaveOracle.WETH())); // {qETH/ETH}
        Fix ethInUsd = toFix(comptroller.oracle().price("ETH")); // {microUSD/ETH}

        // {qETH/tok} * {microUSD/ETH} / {qETH/ETH} * {attoUSD/microUSD}
        return inETH.mul(ethInUsd).div(ethNorm).shiftLeft(12);
    }
}
