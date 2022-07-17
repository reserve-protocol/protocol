// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/governance/utils/IVotesUpgradeable.sol";
import "contracts/p1/StRSR.sol";

interface IStRSRVotes is IVotesUpgradeable {
    /// @return The current era
    function currentEra() external view returns (uint256);

    /// @return The era at a past block number
    function getPastEra(uint256 blockNumber) external view returns (uint256);

    /// @return blockNumber The block number at which the exchange rate was first reached
    /// @return rate {qStRSR/qRSR} The exchange rate at the time, as a Fix
    function getPastExchangeRate(uint256 index)
        external
        view
        returns (uint32 blockNumber, uint192 rate);
}

/*
 * @title StRSRP1Votes
 * @notice StRSRP1Votes TODO
 */
contract StRSRP1Votes is StRSRP1, IStRSRVotes {
    bytes32 private constant _DELEGATE_TYPEHASH =
        keccak256("Delegation(address delegatee,uint256 nonce,uint256 expiry)");

    // {delegator} => {delegatee}
    mapping(address => address) private _delegates;

    // {era} => ({account} => {voting power})
    mapping(uint256 => mapping(address => uint256)) private _votingPower;

    // === Milestones -- Mechanism for locking StRSR per-vote ===

    // The milestone is an arbitrary key that allows the owner of the contract to unlock large 
    // amounts of RToken in a single step via a release step

    // {era} => {tokens locked}
    mapping(uint256 => uint256) private tokensLocked; // {qRTok}

    // {era} => ({milestone} => {tokens locked})
    mapping(uint256 => mapping(uint256 => uint256)) private tokensLockedForMilestone; // {qRTok}


    // {era} => ({account} => {tokens locked})
    mapping(uint256 => mapping(address => uint256)) private tokensLockedForAccount; // {qRTok}


    /// @custom:governance
    function lockVotesForMilestone(
        address account,
        uint256 amount,
        uint256 milestone
    ) external governance {
        // TODO wait a second...how can delegates and vote locking possibly be compatible? 
        // The issue: when someone votes and this results in a lock, it's not clear whose tokens they locked. Did they
        // lock tokens they hold directly or tokens they hold for others? Can others transfer their tokens they have delegated
        // that have been locked? Which set of delegators are locked? Is it a first-come-first-serve?
    }

    /// @custom:governance
    function releaseMilestone(uint256 milestone) external governance {}

    function delegates(address account) public view returns (address) {
        return _delegates[account];
    }

    function getVotes(address account) public view returns (uint256) {
        return _votingPower[era][account];
    }

    function delegate(address delegatee) public {
        _delegate(_msgSender(), delegatee);
    }

    function delegateBySig(
        address delegatee,
        uint256 nonce,
        uint256 expiry,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public {
        require(block.timestamp <= expiry, "ERC20Votes: signature expired");
        address signer = ECDSAUpgradeable.recover(
            _hashTypedDataV4(keccak256(abi.encode(_DELEGATE_TYPEHASH, delegatee, nonce, expiry))),
            v,
            r,
            s
        );
        require(nonce == _useNonce(signer), "ERC20Votes: invalid nonce");
        _delegate(signer, delegatee);
    }

    function _mint(address account, uint256 amount) internal override {
        super._mint(account, amount);
        _writeCheckpoint(_totalSupplyCheckpoints[era], _add, amount);
    }

    function _burn(address account, uint256 amount) internal override {
        super._burn(account, amount);
        _writeCheckpoint(_totalSupplyCheckpoints[era], _subtract, amount);
    }

    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        _moveVotingPower(delegates(from), delegates(to), amount);
    }

    function _delegate(address delegator, address delegatee) internal {
        address currentDelegate = delegates(delegator);
        uint256 delegatorBalance = balanceOf(delegator);
        _delegates[delegator] = delegatee;

        emit DelegateChanged(delegator, currentDelegate, delegatee);

        _moveVotingPower(currentDelegate, delegatee, delegatorBalance);
    }

    function _moveVotingPower(
        address src,
        address dst,
        uint256 amount
    ) private {
        if (src != dst && amount > 0) {
            if (src != address(0)) {
                emit DelegateVotesChanged(
                    src,
                    _votingPower[era][src],
                    _votingPower[era][src] - amount
                );
                _votingPower[era][src] -= amount;
            }

            if (dst != address(0)) {
                emit DelegateVotesChanged(
                    dst,
                    _votingPower[era][dst],
                    _votingPower[era][dst] + amount
                );
                _votingPower[era][dst] -+= amount;
            }
        }
    }
}
