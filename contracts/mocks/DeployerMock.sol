// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../mixins/Versioned.sol";
import "../interfaces/IDeployer.sol";
import "../interfaces/IMain.sol";

contract DeployerMock is Versioned {
    // Implementation contracts - mock
    Implementations private _implementations;

    constructor() {
        _implementations.main = IMain(address(1)); // used in test
    }

    function implementations() external view returns (Implementations memory) {
        return _implementations;
    }
}

contract DeployerMockV2 is DeployerMock {
    function version() public pure virtual override returns (string memory) {
        return "V2";
    }
}
