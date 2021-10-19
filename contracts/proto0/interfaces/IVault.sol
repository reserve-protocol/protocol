// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/ICollateral.sol";

struct Basket {
    mapping(uint256 => ICollateral) collateral;
    uint256 size;
}

interface IVault {
    function issue(uint256 amount) external;

    function redeem(address redeemer, uint256 amount) external;

    function tokenAmounts(uint256 amount) external view returns (uint256[] memory);

    function basketSize() external view returns (uint256);

    function collateralAt(uint256 index) external view returns (address);

    function basketFiatcoinRate() external returns (uint256);

    function basketUnits(address account) external view returns (uint256);
}
