// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./ICollateral.sol";

interface IOracle {
    function fiatcoinPrice(ICollateral collateral) external view returns (uint256);

    function consultAAVE(address token) external view returns (uint256);

    function consultCOMP(address token) external view returns (uint256);
}
