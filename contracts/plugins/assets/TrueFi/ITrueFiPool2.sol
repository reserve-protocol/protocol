// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

interface ITrueFiPool2 {
    // Returns total value of pool including defaulted loans
    function poolValue() external view returns (uint256);

    // Returns total defaulted loan in safu (can be repaid in future)
    function deficitValue() external view returns (uint256);
}
