// SPDX-License-Identifier: ISC
pragma solidity 0.8.19;

import "./CurvePoolMock.sol";
import "./ERC20Mock.sol";

contract CurveMetapoolMock is CurvePoolMock, ERC20Mock {
    constructor(uint256[] memory intialBalances, address[] memory _coins)
        CurvePoolMock(intialBalances, _coins)
        ERC20Mock("Mock CurveMetaPool", "Mock CMP")
    {}
}
