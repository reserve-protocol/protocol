// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../assets/compoundv2/ICToken.sol";
import "./ERC20Mock.sol";

contract ComptrollerMock is IComptroller {
    mapping(address => uint256) public compBalances;

    ERC20Mock public compToken;

    constructor() {}

    function setCompToken(address compToken_) external {
        compToken = ERC20Mock(compToken_);
    }

    function setRewards(address recipient, uint256 amount) external {
        compBalances[recipient] = amount;
    }

    function claimComp(
        address[] memory holders,
        address[] memory,
        bool,
        bool
    ) external {
        // Mint amount and update internal balances
        address holder = holders[0];
        if (address(compToken) != address(0)) {
            uint256 amount = compBalances[holder];
            compBalances[holder] = 0;
            compToken.mint(holder, amount);
        }
    }

    function getCompAddress() external view returns (address) {
        return address(compToken);
    }

    // mock
    function enterMarkets(address[] calldata) external returns (uint256[] memory) {
        return new uint256[](1);
    }
}
