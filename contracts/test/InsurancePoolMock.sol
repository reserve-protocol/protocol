// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../modules/InsurancePool.sol";

contract InsurancePoolMock is InsurancePool {
    function depositsCount() external view returns (uint256) {
        return deposits.length;
    }

    function processDeposits() external {
        _processDeposits();
    }

    function withdrawalsCount() external view returns (uint256) {
        return withdrawals.length;
    }

    function processWithdrawals() external {
        _processWithdrawals();
    }

    function revenuesCount() external view returns (uint256) {
        return revenues.length;
    }
}
