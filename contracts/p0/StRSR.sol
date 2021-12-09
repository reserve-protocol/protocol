// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IStRSR.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

/*
 * @title StRSRP0
 * @notice The StRSR is where people can stake their RSR in order to provide insurance and
 * benefit from the supply expansion of an RToken.
 *
 * There's an important assymetry in the StRSR. When RSR is added, it must be split only
 * across non-withdrawing balances, while when RSR is seized, it must be seized from both
 * balances that are in the process of being withdrawn and those that are not.
 */
contract StRSRP0 is IStRSR, Context {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;

    IMain public main;

    // Staking Token Name and Symbol
    string private _name;
    string private _symbol;

    // Amount of RSR staked per account
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    // List of accounts
    EnumerableSet.AddressSet internal _accounts;

    // Total staked
    uint256 internal _totalStaked;

    // Delayed Withdrawals
    struct Withdrawal {
        address account;
        uint256 amount;
        uint256 availableAt;
    }

    Withdrawal[] public withdrawals;
    uint256 public withdrawalIndex;

    constructor(
        IMain main_,
        string memory name_,
        string memory symbol_
    ) {
        main = main_;
        _name = name_;
        _symbol = symbol_;
    }

    /// Stakes an RSR `amount` on the corresponding RToken to earn yield and insure the system
    /// @param amount {qRSR}
    function stake(uint256 amount) external override {
        // Process pending withdrawals
        processWithdrawals();

        require(amount > 0, "Cannot stake zero");

        main.rsr().safeTransferFrom(_msgSender(), address(this), amount);
        _accounts.add(_msgSender());
        _balances[_msgSender()] += amount;
        _totalStaked += amount;
        emit Staked(_msgSender(), amount);
    }

    /// Begins a delayed unstaking for `amount` stRSR
    /// @param amount {qRSR}
    function unstake(uint256 amount) external override {
        // Process pending withdrawals
        processWithdrawals();

        require(amount > 0, "Cannot withdraw zero");
        require(_balances[_msgSender()] >= amount, "Not enough balance");

        // Take it out up front
        _balances[_msgSender()] -= amount;
        _totalStaked -= amount;

        // Submit delayed withdrawal
        uint256 availableAt = block.timestamp + main.stRSRWithdrawalDelay();
        withdrawals.push(Withdrawal(_msgSender(), amount, availableAt));
        emit UnstakingStarted(withdrawals.length - 1, _msgSender(), amount, availableAt);
    }

    function balanceOf(address account) external view override returns (uint256) {
        return _balances[account];
    }

    function processWithdrawals() public {
        if (main.paused() || !main.fullyCapitalized()) {
            return;
        }
        // Process all pending withdrawals
        for (uint256 index = withdrawalIndex; index < withdrawals.length; index++) {
            if (block.timestamp > withdrawals[withdrawalIndex].availableAt) {
                Withdrawal storage withdrawal = withdrawals[withdrawalIndex];

                if (withdrawal.amount > 0) {
                    main.rsr().safeTransfer(withdrawal.account, withdrawal.amount);
                }

                delete withdrawals[withdrawalIndex];
                withdrawalIndex += 1;
                emit UnstakingCompleted(index, withdrawal.account, withdrawal.amount);
            } else {
                break;
            }
        }
    }

    function notifyOfDeposit(IERC20 erc20) external override {
        require(erc20 == main.rsr(), "RSR dividends only");

        uint256 balance = main.rsr().balanceOf(address(this));
        uint256 overage = balance - _totalStaked - _amountBeingWithdrawn();

        if (overage > 0) {
            for (uint256 index = 0; index < _accounts.length(); index++) {
                // amtToAdd = amount * _balances[_accounts.at(index)] / snapshotTotalStaked;
                Fix amtToAdd = toFix(_balances[_accounts.at(index)]).mulu(overage).divu(
                    _totalStaked
                );
                _balances[_accounts.at(index)] += amtToAdd.toUintFloor();
            }
            _totalStaked += overage;
            emit RSRAdded(_msgSender(), overage);
        }
    }

    /// auth: BackingTrader only
    /// @param amount {qRSR}
    function seizeRSR(uint256 amount) external override {
        require(_msgSender() == address(main.getBackingTrader()), "Caller is not backing trader");
        require(amount > 0, "Amount cannot be zero");

        // Process pending withdrawals
        processWithdrawals();

        uint256 snapshotTotalStakedPlus = _totalStaked + _amountBeingWithdrawn();

        // _totalStaked -= (amount * _totalStaked) / snapshotTotalStakedPlus;
        _totalStaked -= toFix(amount)
        .mulu(_totalStaked)
        .divu(snapshotTotalStakedPlus)
        .toUintFloor();

        // Remove RSR for stakers and from withdrawals too
        if (snapshotTotalStakedPlus > 0) {
            for (uint256 index = 0; index < _accounts.length(); index++) {
                Fix amtToRemove = toFix(_balances[_accounts.at(index)]).mulu(amount).divu(
                    snapshotTotalStakedPlus
                );
                _balances[_accounts.at(index)] -= amtToRemove.toUintFloor();
            }

            for (uint256 index = withdrawalIndex; index < withdrawals.length; index++) {
                Fix amtToRemove = toFix(withdrawals[index].amount).mulu(amount).divu(
                    snapshotTotalStakedPlus
                );
                withdrawals[index].amount -= amtToRemove.toUintFloor();
            }
        }
        // Transfer RSR to caller
        main.rsr().safeTransfer(_msgSender(), amount);
        emit RSRSeized(_msgSender(), amount);
    }

    // ERC20 Interface
    function name() public view returns (string memory) {
        return _name;
    }

    function symbol() public view returns (string memory) {
        return _symbol;
    }

    function decimals() public pure returns (uint8) {
        return 18;
    }

    function totalSupply() external view override returns (uint256) {
        return _totalStaked + _amountBeingWithdrawn();
    }

    function transfer(address recipient, uint256 amount) external override returns (bool) {
        _transfer(_msgSender(), recipient, amount);
        return true;
    }

    function _transfer(
        address sender,
        address recipient,
        uint256 amount
    ) private {
        require(sender != address(0), "ERC20: transfer from the zero address");
        require(recipient != address(0), "ERC20: transfer to the zero address");

        // Process pending withdrawals
        processWithdrawals();

        require(_balances[sender] >= amount, "ERC20: transfer amount exceeds balance");
        _balances[sender] -= amount;
        _balances[recipient] += amount;
        _accounts.add(recipient);
    }

    function allowance(address owner_, address spender) public view override returns (uint256) {
        return _allowances[owner_][spender];
    }

    function approve(address spender, uint256 amount) public override returns (bool) {
        _approve(_msgSender(), spender, amount);
        return true;
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public override returns (bool) {
        _transfer(sender, recipient, amount);

        uint256 currentAllowance = _allowances[sender][_msgSender()];
        require(currentAllowance >= amount, "ERC20: transfer amount exceeds allowance");
        _approve(sender, _msgSender(), currentAllowance - amount);
        return true;
    }

    function _approve(
        address owner_,
        address spender,
        uint256 amount
    ) private {
        require(owner_ != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

        _allowances[owner_][spender] = amount;
    }

    /// @return total {stRSR} Total amount of stRSR being withdrawn
    function _amountBeingWithdrawn() internal view returns (uint256 total) {
        for (uint256 index = withdrawalIndex; index < withdrawals.length; index++) {
            total += withdrawals[index].amount;
        }
    }
}
