// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "contracts/interfaces/IStRSRVotes.sol";
import "contracts/p1/StRSR.sol";

/*
 * @title StRSRP1Votes
 * @notice StRSRP1Votes is an extension of StRSRP1 that makes it IVotesUpgradeable.
 *   It is heavily based on OZ's ERC20VotesUpgradeable
 */
contract StRSRP1Votes is StRSRP1, IStRSRVotes {
    struct Checkpoint {
        uint48 fromBlock;
        uint224 val;
    }

    bytes32 private constant _DELEGATE_TYPEHASH =
        keccak256("Delegation(address delegatee,uint256 nonce,uint256 expiry)");

    mapping(address => address) private _delegates;

    Checkpoint[] private _eras; // {era}

    // {era} => ...
    mapping(uint256 => mapping(address => Checkpoint[])) private _checkpoints; // {qStRSR}
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

    function currentEra() external view returns (uint256) {
        return era;
    }

    function checkpoints(address account, uint48 pos) public view returns (Checkpoint memory) {
        return _checkpoints[era][account][pos];
    }

    function numCheckpoints(address account) public view returns (uint48) {
        return SafeCastUpgradeable.toUint32(_checkpoints[era][account].length);
    }

    function delegates(address account) public view returns (address) {
        return _delegates[account];
    }

    function getVotes(address account) public view returns (uint256) {
        uint256 pos = _checkpoints[era][account].length;
        return pos == 0 ? 0 : _checkpoints[era][account][pos - 1].val;
    }

    function getPastVotes(address account, uint256 blockNumber) public view returns (uint256) {
        require(blockNumber < block.number, "ERC20Votes: block not yet mined");
        uint256 pastEra = _checkpointsLookup(_eras, blockNumber);
        return _checkpointsLookup(_checkpoints[pastEra][account], blockNumber);
    }

    function getPastTotalSupply(uint256 blockNumber) public view returns (uint256) {
        require(blockNumber < block.number, "ERC20Votes: block not yet mined");
        uint256 pastEra = _checkpointsLookup(_eras, blockNumber);
        return _checkpointsLookup(_totalSupplyCheckpoints[pastEra], blockNumber);
    }

    function getPastEra(uint256 blockNumber) public view returns (uint256) {
        require(blockNumber < block.number, "ERC20Votes: block not yet mined");
        return _checkpointsLookup(_eras, blockNumber);
    }

    function _checkpointsLookup(Checkpoint[] storage ckpts, uint256 blockNumber)
        private
        view
        returns (uint256)
    {
        // We run a binary search to look for the earliest checkpoint taken after `blockNumber`.
        uint256 high = ckpts.length;
        uint256 low = 0;
        while (low < high) {
            uint256 mid = MathUpgradeable.average(low, high);
            if (ckpts[mid].fromBlock > blockNumber) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }

        return high == 0 ? 0 : ckpts[high - 1].val;
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

    function _writeCheckpoint(
        Checkpoint[] storage ckpts,
        function(uint256, uint256) view returns (uint256) op,
        uint256 delta
    ) private returns (uint256 oldWeight, uint256 newWeight) {
        uint256 pos = ckpts.length;
        oldWeight = pos == 0 ? 0 : ckpts[pos - 1].val;
        newWeight = op(oldWeight, delta);

        if (pos > 0 && ckpts[pos - 1].fromBlock == block.number) {
            ckpts[pos - 1].val = SafeCastUpgradeable.toUint224(newWeight);
        } else {
            ckpts.push(
                Checkpoint({
                    fromBlock: SafeCastUpgradeable.toUint32(block.number),
                    val: SafeCastUpgradeable.toUint224(newWeight)
                })
            );
        }
    }

    function _add(uint256 a, uint256 b) private pure returns (uint256) {
        return a + b;
    }

    function _subtract(uint256 a, uint256 b) private pure returns (uint256) {
        return a - b;
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[46] private __gap;
}
