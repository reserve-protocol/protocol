// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/ICollateral.sol";

struct Basket {
    mapping(uint256 => ICollateral) collateral;
    mapping(uint256 => uint256) quantities;
    uint256 size;
}

interface IVault {
    function issue(uint256 amount) external;

    function redeem(address redeemer, uint256 amount) external;

    function basketFiatcoinRate() external returns (uint256);

    function maxIssuable(address issuer) external view returns (uint256);

    function tokenAmounts(uint256 amount) external view returns (uint256[] memory);

    function collateralAt(uint256 index) external view returns (ICollateral);

    function basketSize() external view returns (uint256);

    function basketUnits(address account) external view returns (uint256);

    function quantity(ICollateral collateral) external view returns (uint256);

    function getBackups() external view returns (IVault[] memory);

    function backupAt(uint256 index) external view returns (IVault);
}
