// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "contracts/p1/StRSRVotes.sol";

/*
 * @title Governance
 * @dev Decentralized Governance for the Reserve Protocol.
 *
 * Note that due to the elastic supply of StRSR, proposalThreshold is handled
 *   very differently than the typical approach. It is in terms of micro %,
 *   as is _getVotes().
 */
contract Governance is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    struct ProposalDetails {
        address proposer;
        uint256 blockNumber;
    }

    mapping(uint256 => ProposalDetails) private _proposalDetails;

    // solhint-disable no-empty-blocks
    constructor(
        IStRSRVotes token_,
        TimelockController timelock_,
        uint256 votingDelay_, // in blocks
        uint256 votingPeriod_, // in blocks
        uint256 proposalThresholdAsMicroPercent_, // e.g. 1e4 for 0.01%
        uint256 quorumPercent // e.g 4 for 4%
    )
        Governor("MyGovernor")
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
        proposalId = super.propose(targets, values, calldatas, description);

        ProposalDetails storage proposalDetails = _proposalDetails[proposalId];
        proposalDetails.proposer = _msgSender();
        proposalDetails.blockNumber = block.number;
    }

    /// Three ways to cancel
    /// 1. Be the proposer
    /// 2. The proposer doesn't have votes anymore
    /// 3. The StRSR era has changed
    function cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) public {
        uint256 proposalId = hashProposal(targets, values, calldatas, descriptionHash);
        ProposalDetails storage details = _proposalDetails[proposalId];
        IStRSRVotes token_ = IStRSRVotes(address(token));

        require(
            _msgSender() == details.proposer ||
                getVotes(details.proposer, block.number - 1) < proposalThreshold() ||
                token_.currentEra() != token_.getPastEra(details.blockNumber),
            "Governor: proposer above threshold and same era"
        );

        _cancel(targets, values, calldatas, descriptionHash);
    }

    /// An alternate way to cancel: anyone can cancel a proposal if the StRSR exchange rate has
    /// inflated more than 50%.
    /// @param startIndex The index of the `IStRSRVotes.getPastExchangeRate` that begins the span
    /// @param endIndex The index of the `IStRSRVotes.getPastExchangeRate` that ends the span
    function alternativeCancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash,
        uint256 startIndex,
        uint256 endIndex
    ) public {
        require(endIndex > startIndex, "Governor: invalid indices");

        uint256 proposalId = hashProposal(targets, values, calldatas, descriptionHash);
        ProposalDetails storage details = _proposalDetails[proposalId];

        // rates are in {qStRSR/qRSR}

        (uint32 nextBlockNumber, ) = IStRSRVotes(address(token)).getPastExchangeRate(
            startIndex + 1
        );

        // The value at `startIndex` needs to be no later than the _last_ exchange rate
        // recorded before the proposal was created.
        require(nextBlockNumber >= details.blockNumber, "Governor: invalid startIndex");

        (, uint192 startRate) = IStRSRVotes(address(token)).getPastExchangeRate(startIndex);

        (, uint192 endRate) = IStRSRVotes(address(token)).getPastExchangeRate(endIndex);

        require(endRate > (startRate * 3) / 2, "Governor: rate not inflated");

        _cancel(targets, values, calldatas, descriptionHash);
    }

    function _execute(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        IStRSRVotes token_ = IStRSRVotes(address(token));
        uint256 blockNumber = _proposalDetails[proposalId].blockNumber;

        require(token_.currentEra() == token_.getPastEra(blockNumber), "new era");
        super._execute(proposalId, targets, values, calldatas, descriptionHash);
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

    /// @return The percent of the StRSR supply the account has in terms of micro %: 1e5 = 0.1%
    function _getVotes(
        address account,
        uint256 blockNumber,
        bytes memory /*params*/
    ) internal view override(Governor, GovernorVotes) returns (uint256) {
        uint256 bal = token.getPastVotes(account, blockNumber);
        uint256 totalSupply = token.getPastTotalSupply(blockNumber);

        if (totalSupply > 0) {
            return (bal * 1e8) / totalSupply;
        } else {
            return 0;
        }
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
