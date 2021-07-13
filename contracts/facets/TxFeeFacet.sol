// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/ITxFee.sol";

contract TxFeeFacet is ITxFee {

    function calculateFee(
        address from,
        address to,
        uint256 amount
    ) external view returns (uint256) {
        return 0;
    }
}
