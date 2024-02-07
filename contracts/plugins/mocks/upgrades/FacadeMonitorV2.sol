// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../../facade/FacadeMonitor.sol";

/**
 * @title FacadeMonitorV2
 * @notice Mock to test upgradeability for the FacadeMonitor contract
 */
contract FacadeMonitorV2 is FacadeMonitor {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(MonitorParams memory params) FacadeMonitor(params) {}

    uint256 public newValue;

    function setNewValue(uint256 newValue_) external onlyOwner {
        newValue = newValue_;
    }

    function version() public pure returns (string memory) {
        return "2.0.0";
    }
}
