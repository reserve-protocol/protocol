// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./ERC20MockDecimals.sol";

contract ERC20MockRewarding is ERC20MockDecimals {
    ERC20MockDecimals public rewardToken;
    mapping(address => uint256) public accruedRewards;

    // solhint-disable-next-line no-empty-blocks
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_,
        ERC20MockDecimals rewardToken_
    ) ERC20MockDecimals(name, symbol, decimals_) {
        rewardToken = rewardToken_;
    }

    function accrueRewards(uint256 amount, address recipient) external {
        rewardToken.mint(address(this), amount);
        accruedRewards[recipient] += amount;
    }

    function claim() external {
        rewardToken.transfer(msg.sender, accruedRewards[msg.sender]);
        accruedRewards[msg.sender] = 0;
    }
}
