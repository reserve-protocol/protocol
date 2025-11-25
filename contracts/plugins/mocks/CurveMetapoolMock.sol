// SPDX-License-Identifier: ISC
pragma solidity 0.8.28;

import "./CurvePoolMock.sol";
import "./ERC20Mock.sol";

contract CurveMetapoolMock is CurvePoolMock, ERC20Mock {
    constructor(uint256[] memory intialBalances, address[] memory _coins)
        CurvePoolMock(intialBalances, _coins)
        ERC20Mock("Mock CurveMetaPool", "Mock CMP")
    {}

    function totalSupply() public view override(CurvePoolMock, ERC20) returns (uint256) {
        return ERC20.totalSupply();
    }
}
