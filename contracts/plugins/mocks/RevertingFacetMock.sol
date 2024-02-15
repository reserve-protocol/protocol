// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

contract RevertingFacetMock {
    constructor() {}

    fallback() external {
        revert("RevertingFacetMock");
    }
}
