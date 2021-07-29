// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "./helpers/ErrorMessages.sol";

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
 *  1. Load a balance for an account exactly once.
 *  2. Only load a balance if the old RSR is paused.
 *  3. Ensure old RSR can never be unpaused.
 *
 * Note that there is one exception to this:
 * - SlowWallet: The SlowWallet balance should be moved into the Reserve multisig. 
 */
contract RSR is ERC20Votes {

    /// ==== Immutable ====

    IPrevRSR public immutable prevRSR;

    address public immutable slowWallet;
    address public immutable multisigWallet;
    uint256 public immutable fixedSupply;

    /// ==== Mutable ====

    mapping(address => bool) public crossed;

    constructor(
        address prevRSR_,
        address slowWallet_,
        address multisigWallet_
    ) ERC20("Reserve Rights", "RSR") ERC20Permit("Reserve Rights") {
        prevRSR = IPrevRSR(prevRSR_);
        slowWallet = slowWallet_;
        multisigWallet = multisigWallet_;

        fixedSupply = IPrevRSR(prevRSR_).totalSupply();

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


    // ========================= External =============================

    /// A light wrapper for ERC20 transfer that crosses the account over if necessary.
    function transfer(address recipient, uint256 amount)
        public
        override
        crossover(_msgSender())
        returns (bool)
    {
        return super.transfer(recipient, amount);
    }

    /// A light wrapper for ERC20 transferFrom that crosses the account over if necessary.
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public override crossover(sender) returns (bool) {
        return super.transferFrom(sender, recipient, amount);
    }

    /// Returns the fixed total supply of the token. 
    function totalSupply() public view override returns (uint256) {
        return fixedSupply;
    }

    /// A light wrapper for ERC20 balanceOf that shows balances across both RSR deployments. 
    function balanceOf(address account) public view override returns (uint256) {
        if (!crossed[account]) {
            return prevRSR.balanceOf(account) + super.balanceOf(account);
        }
        return super.balanceOf(account);
    }

    // ========================= Internal =============================

    /// A hook for the internal ERC20 transfer fucntion that prevents accidental sends to the contract. 
    function _beforeTokenTransfer(
        address,
        address to,
        uint256
    ) internal view override {
        if (to == address(this)) {
            revert TransferToContractAddress();
        }
    }

    /// IMPORTANT!
    /// 
    /// Implements a one-time crossover from the old RSR, per account. 
    function _crossover(address account) internal {
        if (crossed[account]) {
            revert CrossedAlready();
        }

        crossed[account] = true;
        uint256 amount = prevRSR.balanceOf(account);

        // The multisig inherits the slow wallet balance in addition to its own.
        if (account == multisigWallet && slowWallet != multisigWallet && !crossed[slowWallet]) {
            amount += prevRSR.balanceOf(slowWallet);
            crossed[slowWallet] = true;
        }

        _mint(account, amount);
    }
}
