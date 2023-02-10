// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "../../interfaces/IStRSRVotes.sol";

/*
 * @title Governance
 * @dev Decentralized Governance for the Reserve Protocol.
 *
 * Note that due to the elastic supply of StRSR, proposalThreshold is handled
 *   very differently than the typical approach. It is in terms of micro %,
 *   as is _getVotes().
 *
 * 1 * {micro %} = 1e8
 */
contract Governance is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    // solhint-disable no-empty-blocks
    constructor(
        IStRSRVotes token_,
        TimelockController timelock_,
        uint256 votingDelay_, // in blocks
        uint256 votingPeriod_, // in blocks
        uint256 proposalThresholdAsMicroPercent_, // e.g. 1e4 for 0.01%
        uint256 quorumPercent // e.g 4 for 4%
    )
        Governor("Governor Alexios")
        GovernorSettings(votingDelay_, votingPeriod_, proposalThresholdAsMicroPercent_)
        GovernorVotes(IVotes(address(token_)))
        GovernorVotesQuorumFraction(quorumPercent)
        GovernorTimelockControl(timelock_)
    {}

    // solhint-enable no-empty-blocks

    function votingDelay() public view override(IGovernor, GovernorSettings) returns (uint256) {
        return super.votingDelay();
    }

    function votingPeriod() public view override(IGovernor, GovernorSettings) returns (uint256) {
        return super.votingPeriod();
    }

    /// @return The proposal threshold in units of micro %, e.g 1e6 for 1% of the supply
    function proposalThreshold()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.proposalThreshold();
    }

    /// @return Returns the quorum required, in units of micro %, e.g 4e6 for 4%
    function quorum(uint256)
        public
        view
        override(IGovernor, GovernorVotesQuorumFraction)
        returns (uint256)
    {
        return quorumNumerator() * 1e6;
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
    ) external {
        uint256 proposalId = _cancel(targets, values, calldatas, descriptionHash);
        require(!startedInSameEra(proposalId), "same era");
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

    /// @return {micro %} The portion of the StRSR supply the account had at a previous blocknumber
    function _getVotes(
        address account,
        uint256 blockNumber,
        bytes memory /*params*/
    ) internal view override(Governor, GovernorVotes) returns (uint256) {
        uint256 bal = token.getPastVotes(account, blockNumber); // {qStRSR}
        uint256 totalSupply = token.getPastTotalSupply(blockNumber); // {qStRSR}

        if (totalSupply == 0) return 0;

        // {micro %} = {qStRSR} * {micro %} / {qStRSR}
        return (bal * 1e8) / totalSupply;
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
        uint256 startBlock = proposalSnapshot(proposalId);
        uint256 pastEra = IStRSRVotes(address(token)).getPastEra(startBlock);
        uint256 currentEra = IStRSRVotes(address(token)).currentEra();
        return currentEra == pastEra;
    }
}
