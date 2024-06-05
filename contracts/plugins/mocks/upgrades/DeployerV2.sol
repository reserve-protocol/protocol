// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../../p1/Deployer.sol";

/// @custom:oz-upgrades-unsafe-allow external-library-linking
contract DeployerP1V2 is DeployerP1 {
    uint256 public newValue;

    constructor(
        IERC20Metadata rsr_,
        IGnosis gnosis_,
        IAsset rsrAsset_,
        Implementations memory implementations_
    ) DeployerP1(rsr_, gnosis_, rsrAsset_, implementations_) {}

    function setNewValue(uint256 newValue_) external {
        newValue = newValue_;
    }

    function version() public pure override(Versioned, IVersioned) returns (string memory) {
        return "2.0.0";
    }
}
