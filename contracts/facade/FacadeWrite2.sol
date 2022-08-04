// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/governance/TimelockController.sol";
import "contracts/interfaces/IFacadeWrite.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/plugins/governance/Governance.sol";

library FacadeWrite2 {
    /// Emitted when a new Governance is deployed
    /// @param rToken The address of the RToken
    /// @param governance The address of the new governance
    /// @param timelock The address of the timelock
    event GovernanceCreated(
        IRToken indexed rToken,
        address indexed governance,
        address indexed timelock
    );

    /// @return The new owner address (set to the timelock)
    function deployGovernance(
        IMain main,
        IRToken rToken,
        GovernanceParams calldata govParams,
        address guardian
    ) external returns (address) {
        // Deploy Governance
        TimelockController timelock = new TimelockController(
            govParams.minDelay,
            new address[](0),
            new address[](0)
        );
        Governance governance = new Governance(
            IStRSRVotes(address(main.stRSR())),
            timelock,
            govParams.votingDelay,
            govParams.votingPeriod,
            govParams.proposalThresholdAsMicroPercent,
            govParams.quorumPercent
        );

        // Emit event
        emit GovernanceCreated(rToken, address(governance), address(timelock));

        // Setup Roles
        timelock.grantRole(timelock.PROPOSER_ROLE(), address(governance)); // Gov only proposer
        timelock.grantRole(timelock.CANCELLER_ROLE(), guardian); // Guardian as canceller
        timelock.grantRole(timelock.EXECUTOR_ROLE(), address(0)); // Anyone as executor
        timelock.revokeRole(timelock.TIMELOCK_ADMIN_ROLE(), address(this)); // Revoke admin role

        // Return new owner - Timelock
        return address(timelock);
    }
}
