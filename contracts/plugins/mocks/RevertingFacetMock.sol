// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

contract RevertingFacetMock {
    constructor() {}

    fallback() external {
        revert("RevertingFacetMock");
    }
}
