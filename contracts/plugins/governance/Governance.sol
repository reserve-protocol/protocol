// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "../../interfaces/IStRSRVotes.sol";

uint256 constant ONE_DAY = 86400; // {s}

/*
 * @title Governance
 * @dev Decentralized Governance for the Reserve Protocol.
 *
 * Note that due to the elastic supply of StRSR, proposalThreshold is handled
 *   very differently than the typical approach. It is in terms of micro %,
 *   as is _getVotes().
 *
 * 1 {micro %} = 1e8
 */
contract Governance is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    // 100%
    uint256 public constant ONE_HUNDRED_PERCENT = 1e8; // {micro %}

    // solhint-disable-next-line var-name-mixedcase
    uint256 public constant MIN_VOTING_DELAY = 86400; // {s} ONE_DAY

    constructor(
        IStRSRVotes token_,
        TimelockController timelock_,
        uint256 votingDelay_, // {s}
        uint256 votingPeriod_, // {s}
        uint256 proposalThresholdAsMicroPercent_, // e.g. 1e4 for 0.01%
        uint256 quorumPercent // e.g 4 for 4%
    )
        Governor("Governor Anastasius")
        GovernorSettings(votingDelay_, votingPeriod_, proposalThresholdAsMicroPercent_)
        GovernorVotes(IVotes(address(token_)))
        GovernorVotesQuorumFraction(quorumPercent)
        GovernorTimelockControl(timelock_)
    {
        requireValidVotingDelay(votingDelay_);
    }

    function votingDelay() public view override(IGovernor, GovernorSettings) returns (uint256) {
        return super.votingDelay();
    }

    function votingPeriod() public view override(IGovernor, GovernorSettings) returns (uint256) {
        return super.votingPeriod();
    }

    function setVotingDelay(uint256 newVotingDelay) public override {
        requireValidVotingDelay(newVotingDelay);
        super.setVotingDelay(newVotingDelay); // has onlyGovernance modifier
    }

    /// @return {qStRSR} The number of votes required in order for a voter to become a proposer
    function proposalThreshold()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        uint256 asMicroPercent = super.proposalThreshold(); // {micro %}

        // {qStRSR}
        uint256 pastSupply = token.getPastTotalSupply(clock() - 1);
        // max StRSR supply is 1e38

        // CEIL to make sure thresholds near 0% don't get rounded down to 0 tokens
        return (asMicroPercent * pastSupply + (ONE_HUNDRED_PERCENT - 1)) / ONE_HUNDRED_PERCENT;
    }

    function quorum(uint256 timepoint)
        public
        view
        virtual
        override(IGovernor, GovernorVotesQuorumFraction)
        returns (uint256)
    {
        return super.quorum(timepoint);
    }

    function state(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (ProposalState)
    {
        return GovernorTimelockControl.state(proposalId);
    }

    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public override(Governor, IGovernor) returns (uint256 proposalId) {
        // The super call checks that getVotes() >= proposalThreshold()
        return super.propose(targets, values, calldatas, description);
    }

    function queue(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) public override returns (uint256 proposalId) {
        proposalId = super.queue(targets, values, calldatas, descriptionHash);
        require(startedInSameEra(proposalId), "new era");
    }

    function cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) public override(Governor, IGovernor) returns (uint256) {
        uint256 proposalId = _cancel(targets, values, calldatas, descriptionHash);
        require(!startedInSameEra(proposalId), "same era");

        return proposalId;
    }

    function _execute(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._execute(proposalId, targets, values, calldatas, descriptionHash);
        require(startedInSameEra(proposalId), "new era");
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor()
        internal
        view
        override(Governor, GovernorTimelockControl)
        returns (address)
    {
        return super._executor();
    }

    /// @return {qStRSR} The voting weight the account had at a previous timepoint
    function _getVotes(
        address account,
        uint256 timepoint,
        bytes memory /*params*/
    ) internal view override(Governor, GovernorVotes) returns (uint256) {
        return token.getPastVotes(account, timepoint); // {qStRSR}
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // === Private ===

    function startedInSameEra(uint256 proposalId) private view returns (bool) {
        uint256 startTimepoint = proposalSnapshot(proposalId);
        uint256 pastEra = IStRSRVotes(address(token)).getPastEra(startTimepoint);
        uint256 currentEra = IStRSRVotes(address(token)).currentEra();
        return currentEra == pastEra;
    }

    function requireValidVotingDelay(uint256 newVotingDelay) private pure {
        require(newVotingDelay >= MIN_VOTING_DELAY, "invalid votingDelay");
    }

    function clock() public view override(GovernorVotes, IGovernor) returns (uint48) {
        return SafeCast.toUint48(block.timestamp);
    }

    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public pure override(GovernorVotes, IGovernor) returns (string memory) {
        return "mode=timestamp";
    }
}
