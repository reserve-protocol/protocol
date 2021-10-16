// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/ICollateral.sol";

struct Basket {
    mapping(uint16 => ICollateral) collateral;
    uint16 size;
}

interface IVault {
    function issue(uint256 amount) external;

    function redeem(uint256 amount) external;

    function tokenAmounts(uint256 amount) external view returns (uint256[] memory);

    function basketSize() external view returns (uint16);

    function collateralAt(uint16 index) external view returns (address);

    function basketFiatcoinRate() external returns (uint256);
}
