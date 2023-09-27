// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface ICBEth is IERC20Metadata {
    function mint(address account, uint256 amount) external returns (bool);

    function updateExchangeRate(uint256 exchangeRate) external;

    function configureMinter(address minter, uint256 minterAllowedAmount) external returns (bool);

    function exchangeRate() external view returns (uint256 _exchangeRate);
}
