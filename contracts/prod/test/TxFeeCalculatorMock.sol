// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "../interfaces/ITXFee.sol";

contract TXFeeCalculatorMock is ITXFee {
    uint256 private immutable _scale = 100;
    uint256 public feePercent;

    constructor() {
        feePercent = 10;
    }

    function setFeePct(uint256 newFee) external {
        feePercent = newFee;
    }

    function calculateFee(
        address from,
        address to,
        uint256 amount
    ) external view override returns (uint256 feeAmt) {
        from;
        to;
        feeAmt = (amount * feePercent * _scale) / (100 * _scale);
        return feeAmt;
    }
}
