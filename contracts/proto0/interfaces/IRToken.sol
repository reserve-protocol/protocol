// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IRToken is IERC20 {
    function decimals() external view returns (uint8);

    function mint(address recipient, uint256 amount) external returns (bool);

    function burn(address recipient, uint256 amount) external returns (bool);
}
