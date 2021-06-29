// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./zeppelin/token/ERC20/extensions/ERC20Snapshot.sol";

interface IPrevRSR {
    function paused() public view returns(bool);
    function totalSupply() public view returns(uint256);
    function balanceOf() public view returns(uint256);
}

/*
 * @title RSR
 * @dev An ERC20 insurance token for the Reserve Protocol ecosystem. 
 * Migration plan from old RSR:
 *  1. Load a balance for an account exactly once
 *  2. Only load a balance if the old RSR is paused
 *
 * The SlowWallet crossover logic gets special-cased, since otherwise funds would get lost. 
 */
contract RSR is ERC20Snapshot {

    /// ==== Immutable ====

    IPrevRSR public immutable prevRSR;

    address public immutable slowWallet;
    address public immutable multisigWallet;
    uint256 public immutable fixedSupply;

    /// ==== Mutable ====

    mapping(address => bool) public crossed;
    uint256 public tokensToCross;
    address public snapshotter;

    event SnapshotterChanged(address indexed oldSnapshotter, address indexed newSnapshotter);

    constructor (address prevRSR_, address slowWallet_, address multisigWallet_) {
        snapshotter = _msgSender();
        fixedSupply = prevRSR.totalSupply();
        tokensToCross = fixedSupply;
        
        prevRSR = prevRSR_;
        slowWallet = slowWallet_;
        multisigWallet = multisigWallet_;

        // TODO: Crossover now for all Treasury + Team Member + Investor accounts
        // Important: Only crossover the frozen accounts from old RSR.
        //
        // _crossover(some_account);
    }

    modifier crossover(address account) {
        if (!crossed[account] && prevRSR.paused()) {
            _crossover(account);
        }
        _;
    }

    modifier snapshotterOnly() {
        require(_msgSender() == snapshotter, "only snapshotter can snapshot");
        _;
    }

    /// ==== Views ====

    function totalSupply() public view override returns (uint256) {
        return fixedSupply;
    }

    function balanceOf(address account) public view override returns (uint256) {
        if (!crossed[account]) {
            return prevRSR.balanceOf(account);
        }
        return super.balanceOf(account);
    }

    /// ==== External ====

    function transfer(
        address recipient, 
        uint256 amount
    ) external override crossover(recipient) returns (bool) {
        return super.transfer(recipient, amount);
    }

    function allowance(
        address owner, 
        address spender
    ) external view override crossover(owner) returns (uint256) {
        return super.allowance(owner, spender);
    }

    function approve(
        address spender, 
        uint256 amount
    ) external override crossover(spender) returns (bool) {
        return super.approve(spender, amount);
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external override crossover(sender) returns (bool) {
        return super.transferFrom(sender, recipient, amount);
    }

    function increaseAllowance(
        address spender, 
        uint256 addedValue
    ) external crossover(spender) returns (bool) {
        return super.increaseAllowance(spender, addedValue);
    }

    function decreaseAllowance(
        address spender, 
        uint256 subtractedValue
    ) external crossover(spender) returns (bool) {
        return super.decreaseAllowance(spender, subtractedValue);
    }

    function snapshot() external snapshotterOnly returns (uint256) {
        _snapshot();
    }

    function transferSnapshotter(address newSnapshotter) external snapshotterOnly {
        emit SnapshotterChanged(snapshotter, newSnapshotter);
        snapshotter = newSnapshotter;
    }

    /// ==== Internal ====

    function _crossover(address account) internal {
        require(!crossed[account], "can only cross once");
        crossed[account] = true;

        // The multisig inherits the slow wallet balance in addition to its own.
        uint256 amount = prevRSR.balanceOf(account);
        if (account == multisigWallet && slowWallet != multisigWallet) {
            amount += prevRSR.balanceOf(slowWallet);
        }
        _mint(account, amount);
        tokensToCross = tokensToCross - amount;
    }
}
