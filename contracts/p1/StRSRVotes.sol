// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/interfaces/IERC5805Upgradeable.sol";
import "../interfaces/IStRSRVotes.sol";
import "./StRSR.sol";

/*
 * @title StRSRP1Votes
 * @notice StRSRP1Votes is an extension of StRSRP1 that makes it IVotesUpgradeable.
 *   It is heavily based on OZ's ERC20VotesUpgradeable
 */
contract StRSRP1Votes is StRSRP1, IERC5805Upgradeable, IStRSRVotes {
    // A Checkpoint[] is a value history; it faithfully represents the history of value so long
    // as that value is only ever set by _writeCheckpoint. For any *previous* timepoint N, the
    // recorded value at the end of timepoint N was cp.val, where cp in the value history is the
    // Checkpoint value with fromTimepoint maximal such that fromTimepoint <= N.

    // In particular, if the value changed during timepoint N, there will be exactly one
    // entry cp with cp.fromTimepoint = N, and cp.val is the value at the _end_ of that timepoint.
    // 3.4.0: it's actually a timepoint described by clock().
    // !!!! REMEMBER THIS IS 2 SLOTS, NOT ONE, UNLIKE OZ !!!!
    struct Checkpoint {
        uint48 fromTimepoint;
        uint224 val;
    }

    bytes32 private constant _DELEGATE_TYPEHASH =
        keccak256("Delegation(address delegatee,uint256 nonce,uint256 expiry)");

    // _delegates[account] is the address of the delegate that `account` has specified
    mapping(address => address) private _delegates;

    // era history
    Checkpoint[] private _eras; // {era}

    // {era} => ...
    // `_checkpoints[era][account]` is the history of voting power of `account` during era `era`
    mapping(uint256 => mapping(address => Checkpoint[])) private _checkpoints; // {qStRSR}
    // `_totalSupplyCheckpoints[era]` is the history of totalSupply values during era `era`
    mapping(uint256 => Checkpoint[]) private _totalSupplyCheckpoints; // {qStRSR}

    // When RSR is seized, stakeholders are divested not only of their economic position,
    // but also of their governance position.

    // ===

    /// Rebase hook
    /// No need to override beginDraftEra: we are only concerned with raw balances (stakes)
    function beginEra() internal override {
        super.beginEra();

        _writeCheckpoint(_eras, _add, 1);
    }

    function clock() public view returns (uint48) {
        return SafeCastUpgradeable.toUint48(block.timestamp);
    }

    /**
     * @dev Description of the clock
     */
    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public pure returns (string memory) {
        return "mode=timestamp";
    }

    function currentEra() external view returns (uint256) {
        return era;
    }

    function checkpoints(address account, uint48 pos) public view returns (Checkpoint memory) {
        return _checkpoints[era][account][pos];
    }

    function numCheckpoints(address account) public view returns (uint48) {
        return SafeCastUpgradeable.toUint48(_checkpoints[era][account].length);
    }

    function delegates(address account) public view returns (address) {
        return _delegates[account];
    }

    function getVotes(address account) public view returns (uint256) {
        uint256 pos = _checkpoints[era][account].length;
        return pos == 0 ? 0 : _checkpoints[era][account][pos - 1].val;
    }

    function getPastVotes(address account, uint256 timepoint) public view returns (uint256) {
        _requireValidTimepoint(timepoint);

        uint256 pastEra = _checkpointsLookup(_eras, timepoint);
        return _checkpointsLookup(_checkpoints[pastEra][account], timepoint);
    }

    function getPastTotalSupply(uint256 timepoint) public view returns (uint256) {
        _requireValidTimepoint(timepoint);

        uint256 pastEra = _checkpointsLookup(_eras, timepoint);
        return _checkpointsLookup(_totalSupplyCheckpoints[pastEra], timepoint);
    }

    function getPastEra(uint256 timepoint) public view returns (uint256) {
        _requireValidTimepoint(timepoint);

        return _checkpointsLookup(_eras, timepoint);
    }

    /// Return the value from history `ckpts` that was current for timepoint `timepoint`
    function _checkpointsLookup(Checkpoint[] storage ckpts, uint256 timepoint)
        private
        view
        returns (uint256)
    {
        // We run a binary search to look for the last (most recent) checkpoint taken before
        // (or at) `timepoint`.
        //
        // Initially we check if the timepoint is recent to narrow the search range.
        // During the loop, the index of the wanted checkpoint remains
        // in the range [low-1, high).
        // With each iteration, either `low` or `high` is moved towards the middle of the
        // range to maintain the invariant.
        // - If the middle checkpoint is after `timepoint`, we look in [low, mid)
        // - If the middle checkpoint is before or equal to `timepoint`, we look in [mid+1, high)
        // Once we reach a single value (when low == high), we've found the right checkpoint at
        // the index high-1, if not out of bounds (in which case we're looking too far in the past
        //  and the result is 0).
        //
        // Note that if the latest checkpoint available is exactly for `timepoint`, we end up with
        //  an index that is past the end of the array, so we technically don't find a checkpoint
        // after `timepoint`, but it works out the same.
        uint256 length = ckpts.length;

        uint256 low = 0;
        uint256 high = length;

        if (length > 5) {
            uint256 mid = length - MathUpgradeable.sqrt(length);
            if (ckpts[mid].fromTimepoint > timepoint) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }

        while (low < high) {
            uint256 mid = MathUpgradeable.average(low, high);
            if (ckpts[mid].fromTimepoint > timepoint) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }

        unchecked {
            return high == 0 ? 0 : ckpts[high - 1].val;
        }
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
        require(block.timestamp <= expiry, "signature expired");
        address signer = ECDSAUpgradeable.recover(
            _hashTypedDataV4(keccak256(abi.encode(_DELEGATE_TYPEHASH, delegatee, nonce, expiry))),
            v,
            r,
            s
        );
        require(nonce == _useDelegationNonce(signer), "invalid nonce");
        _delegate(signer, delegatee);
    }

    /// Stakes an RSR `amount` on the corresponding RToken and allows to delegate
    /// votes from the sender to `delegatee` or self
    function stakeAndDelegate(uint256 rsrAmount, address delegatee) external {
        stake(rsrAmount);
        address caller = _msgSender();
        address currentDelegate = delegates(caller);

        if (delegatee == address(0) && currentDelegate == address(0)) {
            // Delegate to self if no delegate defined and no delegatee provided
            _delegate(caller, caller);
        } else if (delegatee != address(0) && currentDelegate != delegatee) {
            // Delegate to delegatee if provided and different than current delegate
            _delegate(caller, delegatee);
        }
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
        super._afterTokenTransfer(from, to, amount);
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
        if (src != dst && amount != 0) {
            if (src != address(0)) {
                (uint256 oldWeight, uint256 newWeight) = _writeCheckpoint(
                    _checkpoints[era][src],
                    _subtract,
                    amount
                );
                emit DelegateVotesChanged(src, oldWeight, newWeight);
            }

            if (dst != address(0)) {
                (uint256 oldWeight, uint256 newWeight) = _writeCheckpoint(
                    _checkpoints[era][dst],
                    _add,
                    amount
                );
                emit DelegateVotesChanged(dst, oldWeight, newWeight);
            }
        }
    }

    // Set this timepoint's value in the history `ckpts`
    function _writeCheckpoint(
        Checkpoint[] storage ckpts,
        function(uint256, uint256) view returns (uint256) op,
        uint256 delta
    ) private returns (uint256 oldWeight, uint256 newWeight) {
        uint256 pos = ckpts.length;

        unchecked {
            Checkpoint memory oldCkpt = pos == 0 ? Checkpoint(0, 0) : ckpts[pos - 1];

            oldWeight = oldCkpt.val;
            newWeight = op(oldWeight, delta);

            if (pos != 0 && oldCkpt.fromTimepoint == clock()) {
                ckpts[pos - 1].val = SafeCastUpgradeable.toUint224(newWeight);
            } else {
                ckpts.push(
                    Checkpoint({
                        fromTimepoint: clock(),
                        val: SafeCastUpgradeable.toUint224(newWeight)
                    })
                );
            }
        }
    }

    function _add(uint256 a, uint256 b) private pure returns (uint256) {
        return a + b;
    }

    function _subtract(uint256 a, uint256 b) private pure returns (uint256) {
        return a - b;
    }

    function _requireValidTimepoint(uint256 timepoint) private view {
        require(timepoint < block.timestamp, "future lookup");
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[46] private __gap;
}
