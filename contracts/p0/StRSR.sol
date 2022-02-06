// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/interfaces/IStRSR.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

import "hardhat/console.sol";

/*
 * @title StRSRP0
 * @notice The StRSR is where people can stake their RSR in order to provide insurance and
 * benefit from the supply expansion of an RToken.
 *
 */
contract StRSRP0 is IStRSR, Ownable, ERC20Votes {
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;
    using SafeERC20 for IERC20Metadata;

    IMain public main;

    string private __name;
    string private __symbol;

    // Delayed Withdrawals
    struct Withdrawal {
        address account;
        uint256 weight;
        uint256 availableAt;
    }

    Withdrawal[] public withdrawals;

    /*
     * Accounting Economics
     * - The system state is at any one time a function of:
     *   a. The RSR balance of the pool
     *   b. The superclass's balance, allowance, and totalSupply
     *   c. The withdrawal queue
     *
     * Superclass
     * - The private superclass `_balances` mapping is of type {weight}
     *   | It tracks percent ownership of the pool
     *   | It is unaffected by the transfer of RSR across the contract boundary
     *   | The internal `_mint` and `_burn` functions are used to change weights
     * - However, the superclass `_allowances` array is kept of type {stake}
     *
     * Numeric safety: conversions between {stake} and {weight} are rounded to favor the pool
     * - Chopped-off attos accumulate to the {weight} side
     *
     * {stake}
     * - totalSupply()
     * - balanceOf(account)
     * - allowances(account, other)
     *
     * {weight}
     * - super.balanceOf(account)
     * - super.totalSupply()
     */

    constructor(
        IMain main_,
        string memory name_,
        string memory symbol_,
        address owner_
    ) ERC20Permit(name_) ERC20("UNUSED", "UNUSED") {
        main = main_;
        __name = name_;
        __symbol = symbol_;
        _transferOwnership(owner_);
    }

    function name() public view override returns (string memory) {
        return __name;
    }

    function symbol() public view override returns (string memory) {
        return __symbol;
    }

    /// @return {stake}
    function totalSupply() public view override(ERC20, IERC20) returns (uint256) {
        // may be dust greater than the sum of balances in order to benefit the collective
        return main.rsr().balanceOf(address(this));
    }

    /// @return {stake}
    function balanceOf(address account) public view override(ERC20, IERC20) returns (uint256) {
        return toStake(super.balanceOf(account));
    }

    /// @param amount {stake}
    function transfer(address recipient, uint256 amount)
        public
        override(ERC20, IERC20)
        returns (bool)
    {
        require(balanceOf(_msgSender()) >= amount, "ERC20: transfer amount exceeds balance");
        uint256 weight = toWeight(amount, RoundingApproach.CEIL);
        _transfer(_msgSender(), recipient, weight);
        return true;
    }

    /// @param amount {stake}
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public override(ERC20, IERC20) returns (bool) {
        require(balanceOf(sender) >= amount, "ERC20: transfer amount exceeds balance");
        uint256 currentAllowance = allowance(sender, _msgSender());
        require(currentAllowance >= amount, "ERC20: transfer amount exceeds allowance");

        uint256 weight = toWeight(amount, RoundingApproach.CEIL);
        _transfer(sender, recipient, weight);
        _approve(sender, _msgSender(), currentAllowance - amount);
        return true;
    }

    /// @return Whether it ran
    function tryProcessWithdrawals() public override returns (bool) {
        if (
            main.paused() ||
            !main.fullyCapitalized() ||
            main.worstCollateralStatus() != CollateralStatus.SOUND
        ) return false;

        // Process all pending withdrawals
        for (uint256 i = 0; i < withdrawals.length; i++) {
            if (block.timestamp >= withdrawals[i].availableAt && withdrawals[i].weight > 0) {
                uint256 amount = toStake(withdrawals[i].weight);
                withdrawals[i].weight = 0;
                main.rsr().safeTransfer(withdrawals[i].account, amount);
                emit UnstakingCompleted(i, withdrawals[i].account, amount);
            }
        }
        return true;
    }

    /// Stakes an RSR `amount` immediately
    /// @param amount {stake}
    function stake(uint256 amount) external override {
        require(amount > 0, "Cannot stake zero");
        tryProcessWithdrawals();

        uint256 weight = toWeight(amount, RoundingApproach.FLOOR);
        main.rsr().safeTransferFrom(_msgSender(), address(this), amount);
        _mint(_msgSender(), weight);
    }

    /// Begins a delayed unstaking for `amount` stRSR
    /// @param amount {stake}
    function unstake(uint256 amount) external override {
        require(amount > 0, "Cannot withdraw zero");
        tryProcessWithdrawals();

        uint256 weight = toWeight(amount, RoundingApproach.CEIL);
        _burn(_msgSender(), weight);

        uint256 availableAt = block.timestamp + main.stRSRWithdrawalDelay();
        withdrawals.push(Withdrawal(_msgSender(), weight, availableAt));
        emit UnstakingStarted(withdrawals.length - 1, _msgSender(), amount, availableAt);
    }

    /// @param amount {stake}
    function seizeRSR(uint256 amount) external override {
        require(_msgSender() == address(main), "not main");
        tryProcessWithdrawals();
        main.rsr().safeTransfer(address(main), amount);
    }

    function setMain(IMain main_) external override onlyOwner {
        emit MainSet(main, main_);
        main = main_;
    }

    // ==== Private ====

    /// @param weight {weight}
    /// @return {stake}
    function toStake(uint256 weight) private view returns (uint256) {
        uint256 totalWeight = super.totalSupply() + weightBeingWithdrawn();
        if (totalWeight == 0) return weight;

        // {stake} = {weight} * {stake} / {weight}
        return toFix(weight).mulu(main.rsr().balanceOf(address(this))).divu(totalWeight).floor();
    }

    /// @param amount {stake}
    /// @return {weight}
    function toWeight(uint256 amount, RoundingApproach rounding) private view returns (uint256) {
        uint256 supply = main.rsr().balanceOf(address(this));
        if (supply == 0) return amount;

        // total weight = weight staked directly + weight being withdrawn
        uint256 totalWeight = super.totalSupply() + weightBeingWithdrawn();

        // {weight} = {stake} * {weight} / {stake}
        return toFix(amount).mulu(totalWeight).divu(supply).toUint(rounding);
    }

    /// @return totalWithdraw {weight}
    function weightBeingWithdrawn() private view returns (uint256 totalWithdraw) {
        for (uint256 i = 0; i < withdrawals.length; i++) {
            totalWithdraw += withdrawals[i].weight;
        }
    }
}
