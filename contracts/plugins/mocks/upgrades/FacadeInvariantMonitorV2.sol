// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../../facade/FacadeInvariantMonitor.sol";

/**
 * @title FacadeInvariantMonitorV2
 * @notice Mock to test upgradeability for the FacadeInvariantMonitor contract
 */
contract FacadeInvariantMonitorV2 is FacadeInvariantMonitor {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(MonitorParams memory params) FacadeInvariantMonitor(params) {}

    uint256 public newValue;

    function setNewValue(uint256 newValue_) external onlyOwner {
        newValue = newValue_;
    }

    function version() public pure returns (string memory) {
        return "2.0.0";
    }
}
