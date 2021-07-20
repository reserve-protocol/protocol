// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../libraries/Token.sol";

contract TokenCallerMock {
    using Token for Token.Info;

    Token.Info public innerToken;

    uint256 public deployedAt;

    constructor(Token.Info memory innerToken_) {
        innerToken = innerToken_;
        deployedAt = block.timestamp;
    }

    function adjustQuantity(
        uint256 scale,
        uint256 supplyExpansionRate,
        uint256 timestampDeployed
    ) external {
        innerToken.adjustQuantity(scale, supplyExpansionRate, timestampDeployed);
    }

    function getAdjustedQuantity() external view returns (uint256) {
        uint256 adjusted;
        (, , adjusted, , , , ) = this.innerToken();
        return adjusted;
    }

    function safeApprove(address spender, uint256 amount) external {
        innerToken.safeApprove(spender, amount);
    }

    function safeTransfer(address to, uint256 amount) external {
        innerToken.safeTransfer(to, amount);
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 amount
    ) external {
        innerToken.safeTransferFrom(from, to, amount);
    }

    function getBalance() external view returns (uint256) {
        return innerToken.getBalance();
    }

    function getBalance(address account) external view returns (uint256) {
        return innerToken.getBalance(account);
    }
}
