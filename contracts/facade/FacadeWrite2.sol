// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/governance/TimelockController.sol";
import "contracts/interfaces/IFacadeWrite.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/plugins/governance/Governance.sol";

/// Step 2 of FacadeWrite flow
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

    function setupGovernance(
        IRToken rToken,
        bool deployGovernance,
        bool unfreeze,
        GovernanceParams calldata govParams,
        address owner,
        address guardian,
        address pauser
    ) external returns (address) {
        // Get Main
        IMain main = rToken.main();

        require(main.hasRole(OWNER, address(this)), "ownership already transferred");
        require(main.hasRole(OWNER, msg.sender), "not initial deployer");

        // Remove ownership to sender
        main.revokeRole(OWNER, msg.sender);

        // New owner
        address newOwner;

        if (deployGovernance) {
            require(owner == address(0), "owner should be empty");

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

            // Setup new owner - Timelock
            newOwner = address(timelock);
        } else {
            require(owner != address(0), "owner not defined");

            newOwner = owner;
        }

        // Setup guardian as freeze starter / extender + pauser
        if (guardian != address(0)) {
            // As a further decentralization step it is suggested to further differentiate between
            // these two roles. But this is what will make sense for simple system setup.
            main.grantRole(FREEZE_STARTER, guardian);
            main.grantRole(FREEZE_EXTENDER, guardian);
            main.grantRole(PAUSER, guardian);
        }

        // Setup Pauser
        if (pauser != address(0)) {
            main.grantRole(PAUSER, pauser);
        }

        // Unfreeze if required
        if (unfreeze) {
            main.unfreeze();
        }

        // Transfer Ownership and renounce roles
        main.grantRole(OWNER, newOwner);
        main.grantRole(FREEZE_STARTER, newOwner);
        main.grantRole(FREEZE_EXTENDER, newOwner);
        main.grantRole(PAUSER, newOwner);
        main.renounceRole(OWNER, address(this));
        main.renounceRole(FREEZE_STARTER, address(this));
        main.renounceRole(FREEZE_EXTENDER, address(this));
        main.renounceRole(PAUSER, address(this));

        // Return new owner address
        return newOwner;
    }
}
