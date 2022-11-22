// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/AbstractCollateral.sol";

interface IYToken is IERC20Metadata {
    function pricePerShare() external view returns (uint256);

    function token() external view returns (IERC20Metadata);
}
