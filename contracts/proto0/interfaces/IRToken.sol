// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IRToken is IERC20Metadata {
    function mint(address recipient, uint256 amount) external returns (bool);

    function burn(address recipient, uint256 amount) external returns (bool);
}
