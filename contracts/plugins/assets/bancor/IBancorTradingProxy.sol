// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IBancorTradingProxy is IERC20 {
    function tradeBySourceAmount(
        address sourceToken,
        address targetToken,
        uint256 sourceAmount,
        uint256 maxSourceAmount,
        uint256 deadline,
        address beneficiary
    ) external payable;


}
