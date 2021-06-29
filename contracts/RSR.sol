// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./zeppelin/token/ERC20/ERC20.sol";

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
contract RSR is ERC20 {

    /// ==== Immutable ====

    IPrevRSR public immutable prevRSR;

    address public immutable slowWallet;
    address public immutable multisigWallet;
    uint256 public immutable fixedSupply;

    /// ==== Mutable ====

    mapping(address => bool) public crossed;
    uint256 public tokensToCross;


    constructor (address prevRSR_, address slowWallet_, address multisigWallet_) {
        tokensToCross = prevRSR.totalSupply();
        fixedSupply = tokensToCross;
        
        prevRSR = prevRSR_;
        slowWallet = slowWallet_;
        multisigWallet = multisigWallet_;
    }

    modifier crossover(address account) {
        if (!crossed[account] && prevRSR.paused()) {
            crossed[account] = true;

            // The multisig inherits the slow wallet balance in addition to its own.
            if (account == multisigWallet && slowWallet != multisigWallet) {
                _mint(account, prevRSR.balanceOf(slowWallet));
            }
            _mint(account, prevRSR.balanceOf(account));
            tokensToCross = tokensToCross - balanceOf(account);
        }
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
}
