// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import { ITrueFiPool2 } from "./ITrueFiPool2.sol";

interface IFixedTermLoanAgency {
    // @dev calculate overall value of the pools
    function value(ITrueFiPool2 pool) external view returns (uint256);
}
