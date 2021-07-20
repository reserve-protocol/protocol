// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IPrevRSR {
    function paused() external view returns (bool);

    function totalSupply() external view returns (uint256);

    function balanceOf(address) external view returns (uint256);

    function allowance(address, address) external view returns (uint256);
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
contract RSR is ERC20Votes {
    /// ==== Immutable ====

    IPrevRSR public immutable prevRSR;

    address public immutable slowWallet;
    address public immutable multisigWallet;
    uint256 public immutable fixedSupply;

    /// ==== Mutable ====
    mapping(address => bool) public crossed;
    uint256 public tokensToCross;

    constructor(
        address prevRSR_,
        address slowWallet_,
        address multisigWallet_
    ) ERC20("Reserve Rights", "RSR") ERC20Permit("Reserve Rights") {
        prevRSR = IPrevRSR(prevRSR_);
        uint256 _totalSupply = IPrevRSR(prevRSR_).totalSupply();
        fixedSupply = _totalSupply;
        tokensToCross = _totalSupply;

        slowWallet = slowWallet_;
        multisigWallet = multisigWallet_;

        // TODO: Crossover now for all Treasury + Team Member + Investor accounts
        // Important: Only crossover the frozen accounts from old RSR.
        // e.g.
        // _crossover(some_account);
    }

    modifier crossover(address account) {
        if (!crossed[account] && prevRSR.paused()) {
            _crossover(account);
        }
        _;
    }

    /// ==== Views ====

    function totalSupply() public view override returns (uint256) {
        return fixedSupply;
    }

    function balanceOf(address account) public view override returns (uint256) {
        if (!crossed[account]) {
            return prevRSR.balanceOf(account) + super.balanceOf(account);
        }
        return super.balanceOf(account);
    }

    /// ==== External ====

    function transfer(address recipient, uint256 amount)
        public
        override
        crossover(_msgSender())
        returns (bool)
    {
        require(super.transfer(recipient, amount), "not enough balance");
        return true;

    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public override crossover(sender) returns (bool) {
        require(super.transferFrom(sender, recipient, amount), "not enough balance");
        return true;
    }

    /// ==== Internal ====

    function _beforeTokenTransfer(
        address,
        address to,
        uint256
    ) internal view override {
        require(to != address(this), "ERC20: we thought of you");
    }


    function _crossover(address account) internal {
        require(!crossed[account], "RSR: Can only cross once");
        crossed[account] = true;

        // The multisig inherits the slow wallet balance in addition to its own.
        uint256 amount = prevRSR.balanceOf(account);
        if (account == multisigWallet && slowWallet != multisigWallet && !crossed[slowWallet]) {
            amount += prevRSR.balanceOf(slowWallet);
            crossed[slowWallet] = true;
        }

        _mint(account, amount);
        tokensToCross = tokensToCross - amount;
    }
}
