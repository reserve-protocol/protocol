// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../modules/InsurancePool.sol";

contract InsurancePoolMock is InsurancePool {
    
    function depositsCount() external view returns (uint256) {
        return deposits.length;
    }


    function withdrawalsCount() external view returns (uint256) {
        return withdrawals.length;
    }

    function revenuesCount() external view returns (uint256) {
        return revenues.length;
    }

    function weightsAdjustments(address account, uint256 index) external view returns (uint256, bool) {
        WeightAdjustment memory _adj = _weightsAdjustments[account][index];
        return  (_adj.amount, _adj.updated);
    }
}
