// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.17;

import "./ERC20Solmate.sol";

interface IERC4626 {
    function asset() external returns (ERC20Solmate);
}
