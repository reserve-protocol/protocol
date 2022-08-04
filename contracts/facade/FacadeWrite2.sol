// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/governance/TimelockController.sol";
import "contracts/interfaces/IStRSR.sol";
import "contracts/plugins/governance/Governance.sol";

library FacadeWrite2 {
    /// @return The new owner address (set to the timelock)
    function deployGovernance(
        IStRSRVotes stRSR,
        TimelockController timelock,
        uint256 votingDelay,
        uint256 votingPeriod,
        uint256 proposalThresholdAsMicroPercent,
        uint256 quorumPercent
    ) external returns (address) {
        // Deploy Governance
        return
            address(
                new Governance(
                    stRSR,
                    timelock,
                    votingDelay,
                    votingPeriod,
                    proposalThresholdAsMicroPercent,
                    quorumPercent
                )
            );
    }
}
