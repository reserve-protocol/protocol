// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "contracts/plugins/assets/AbstractCollateral.sol";

interface IVaultToken is IERC20Metadata {
    function pricePerShare() external view returns (uint256);
}
