// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/cryptography/draft-EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
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
contract StRSRP0 is IStRSR, Ownable, EIP712 {
    using SafeERC20 for IERC20;
    using SafeERC20 for IERC20Metadata;
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;

    // ==== ERC20Permit ====

    using Counters for Counters.Counter;

    mapping(address => Counters.Counter) private _nonces;

    // solhint-disable-next-line var-name-mixedcase
    bytes32 private immutable _PERMIT_TYPEHASH =
        keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );

    // ====

    IMain public main;

    // Staking Token Name and Symbol
    string private _name;
    string private _symbol;

    // Amount of RSR staked per account
    mapping(address => uint256) private balances;
    mapping(address => mapping(address => uint256)) private allowances;

    // List of accounts. If balances[user] > 0 then (user is in accounts)
    EnumerableSet.AddressSet internal accounts;

    // Total staked == sum(balances[user] for user in accounts)
    uint256 internal totalStaked;

    // Delayed Withdrawals
    struct Withdrawal {
        address account;
        uint256 amount;
        uint256 availableAt;
    }

    Withdrawal[] public withdrawals;

    constructor(
        IMain main_,
        string memory name_,
        string memory symbol_,
        address owner_
    ) EIP712(name_, "1") {
        main = main_;
        _name = name_;
        _symbol = symbol_;
        _transferOwnership(owner_);
    }

    /// Stakes an RSR `amount` on the corresponding RToken to earn yield and insure the system
    /// @param amount {qRSR}
    function stake(uint256 amount) external override {
        // Process pending withdrawals
        processWithdrawals();

        require(amount > 0, "Cannot stake zero");

        main.rsr().safeTransferFrom(_msgSender(), address(this), amount);
        accounts.add(_msgSender());
        balances[_msgSender()] += amount;
        totalStaked += amount;
        emit Staked(_msgSender(), amount);
    }

    /// Begins a delayed unstaking for `amount` stRSR
    /// @param amount {qRSR}
    function unstake(uint256 amount) external override {
        // Process pending withdrawals
        processWithdrawals();

        require(amount > 0, "Cannot withdraw zero");
        require(balances[_msgSender()] >= amount, "Not enough balance");

        // Take it out up front
        balances[_msgSender()] -= amount;
        totalStaked -= amount;

        // Submit delayed withdrawal
        uint256 availableAt = block.timestamp + main.stRSRWithdrawalDelay();
        withdrawals.push(Withdrawal(_msgSender(), amount, availableAt));
        emit UnstakingStarted(withdrawals.length - 1, _msgSender(), amount, availableAt);
    }

    function balanceOf(address account) external view override returns (uint256) {
        return balances[account];
    }

    function processWithdrawals() public {
        if (main.paused() || !main.fullyCapitalized()) {
            return;
        }
        // Process all pending withdrawals
        for (uint256 i = 0; i < withdrawals.length; i++) {
            if (block.timestamp >= withdrawals[i].availableAt && withdrawals[i].amount > 0) {
                main.rsr().safeTransfer(withdrawals[i].account, withdrawals[i].amount);
                emit UnstakingCompleted(i, withdrawals[i].account, withdrawals[i].amount);
                withdrawals[i].amount = 0;
            }
        }
    }

    function notifyOfDeposit(IERC20 erc20) external override {
        require(erc20 == main.rsr(), "RSR dividends only");

        uint256 balance = main.rsr().balanceOf(address(this));
        uint256 overage = balance - totalStaked - amountBeingWithdrawn();
        uint256 addedAmount = 0;

        if (overage > 0) {
            for (uint256 index = 0; index < accounts.length(); index++) {
                address user = accounts.at(index);
                // amtToAdd == overage * (balance[user] / totalStaked);
                uint256 amtToAdd = toFix(balances[user]).mulu(overage).divu(totalStaked).floor();
                balances[user] += amtToAdd;
                addedAmount += amtToAdd;
            }
            // overage - addedAmount may be nonzero; if so, that dust will wait for the next time.
            totalStaked += addedAmount;
            emit RSRAdded(_msgSender(), addedAmount);
        }
    }

    /// @param amount {qRSR}
    /// @return seizedRSR {qRSR} The actual amount seized. May be dust-larger than `amount`.
    function seizeRSR(uint256 amount) external override returns (uint256 seizedRSR) {
        require(_msgSender() == address(main), "not main");
        require(amount > 0, "Amount cannot be zero");

        // Process pending withdrawals
        processWithdrawals();

        uint256 snapshotTotalStakedPlus = totalStaked + amountBeingWithdrawn();
        // Remove RSR for stakers and from withdrawals too
        if (snapshotTotalStakedPlus > 0) {
            uint256 removedStake = 0;
            for (uint256 index = 0; index < accounts.length(); index++) {
                uint256 amtToRemove = toFix(balances[accounts.at(index)])
                    .mulu(amount)
                    .divu(snapshotTotalStakedPlus)
                    .ceil();
                balances[accounts.at(index)] -= amtToRemove;
                removedStake += amtToRemove;
            }
            totalStaked -= removedStake;
            seizedRSR = removedStake;

            for (uint256 index = 0; index < withdrawals.length; index++) {
                uint256 amtToRemove = toFix(withdrawals[index].amount)
                    .mulu(amount)
                    .divu(snapshotTotalStakedPlus)
                    .ceil();
                withdrawals[index].amount -= amtToRemove;
                seizedRSR += amtToRemove;
            }
        }

        // Transfer RSR to caller
        require(amount <= seizedRSR, "Could not seize requested RSR");
        main.rsr().safeTransfer(_msgSender(), seizedRSR);
        emit RSRSeized(_msgSender(), seizedRSR);
    }

    function setMain(IMain main_) external virtual override onlyOwner {
        emit MainSet(main, main_);
        main = main_;
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
        return totalStaked + amountBeingWithdrawn();
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

        require(balances[sender] >= amount, "ERC20: transfer amount exceeds balance");
        balances[sender] -= amount;
        balances[recipient] += amount;
        accounts.add(recipient);
    }

    function allowance(address owner_, address spender) public view override returns (uint256) {
        return allowances[owner_][spender];
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

        uint256 currentAllowance = allowances[sender][_msgSender()];
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

        allowances[owner_][spender] = amount;

        emit Approval(owner_, spender, amount);
    }

    /// @return total {stRSR} Total amount of stRSR being withdrawn
    function amountBeingWithdrawn() internal view returns (uint256 total) {
        for (uint256 index = 0; index < withdrawals.length; index++) {
            total += withdrawals[index].amount;
        }
    }

    // === ERC20Permit ====

    // From OZ 4.4 release at commit 6bd6b76

    function permit(
        address owner_,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual override {
        require(block.timestamp <= deadline, "ERC20Permit: expired deadline");

        bytes32 structHash = keccak256(
            abi.encode(_PERMIT_TYPEHASH, owner_, spender, value, _useNonce(owner_), deadline)
        );

        bytes32 hash = _hashTypedDataV4(structHash);

        address signer = ECDSA.recover(hash, v, r, s);
        require(signer == owner_, "ERC20Permit: invalid signature");

        _approve(owner_, spender, value);
    }

    function nonces(address owner_) public view virtual override returns (uint256) {
        return _nonces[owner_].current();
    }

    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view override returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _useNonce(address owner_) internal virtual returns (uint256 current) {
        Counters.Counter storage nonce = _nonces[owner_];
        current = nonce.current();
        nonce.increment();
    }
}
