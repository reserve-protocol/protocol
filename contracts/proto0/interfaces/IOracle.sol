// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./ICollateral.sol";

interface IOracle {
    function fiatcoinPrice(ICollateral collateral) external view returns (uint256);

    function consultAave(address token) external view returns (uint256);

    function consultCompound(address token) external view returns (uint256);
}
