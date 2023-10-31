// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./IWrappedERC20.sol";

/**
 * @dev Implementation of the {IERC20} interface.
 *
 * This is a "soft-fork" of Open Zeppelin's ERC20 contract but with some notable
 * changes including:
 *
 *   - The allowance system is changed so that users are either allowed or not.
 *   There are no approved/allowed amounts. `approve` function still exists to
 *   adhere to the ERC-20 interface.
 *
 *   - Adds `allow` for easier authorization and is an easier-to-use alternative
 *   to `approve`.
 *
 *   - All hooks are removed except for `_beforeTokenTransfer` in `_transfer`.
 *   This is done to save on gas.
 *
 *   - All reverts use custom errors instead of strings. Another gas-optimization.
 *
 *   - Adds `hasPermission` which works the same as `allowance` and checks whether
 *   a user is authorized to make balance transfers.
 *
 *   - Some state variables are removed in anticipation of this contract
 *   being inherited by the cUSDCv3 wrapper
 *
 * Additionally, an {Approval} event is emitted on calls to {transferFrom}.
 * This allows applications to reconstruct the allowance for all accounts just
 * by listening to said events. Other implementations of the EIP may not emit
 * these events, as it isn't required by the specification.
 */
abstract contract WrappedERC20 is IWrappedERC20 {
    error BadAmount();
    error Unauthorized();
    error ZeroAddress();
    error ExceedsBalance(uint256 amount);

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => bool)) public isAllowed;

    uint256 private _totalSupply;

    string private _name;
    string private _symbol;

    /**
     * @dev Sets the values for {name} and {symbol}.
     *
     * The default value of {decimals} is 18. To select a different value for
     * {decimals} you should overload it.
     *
     * All two of these values are immutable: they can only be set once during
     * construction.
     */
    constructor(string memory name_, string memory symbol_) {
        _name = name_;
        _symbol = symbol_;
    }

    /**
     * @dev Returns the name of the token.
     */
    function name() public view virtual returns (string memory) {
        return _name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public view virtual returns (string memory) {
        return _symbol;
    }

    /**
     * @dev Returns the decimals places of the token.
     */
    function decimals() public pure virtual returns (uint8) {
        return 18;
    }

    /**
     * @dev See {IERC20-totalSupply}.
     */
    function totalSupply() public view virtual override returns (uint256) {
        return _totalSupply;
    }

    /**
     * @dev See {IERC20-balanceOf}.
     */
    function balanceOf(address account) public view virtual override returns (uint256) {
        return _balances[account];
    }

    /**
     * @dev See {IERC20-transfer}.
     *
     * Requirements:
     *
     * - `to` cannot be the zero address.
     * - the caller must have a balance of at least `amount`.
     */
    function transfer(address to, uint256 amount) public virtual override returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    /**
     * @dev See {IERC20-allowance}.
     */
    function allowance(address owner, address spender)
        public
        view
        virtual
        override
        returns (uint256)
    {
        return hasPermission(owner, spender) ? type(uint256).max : 0;
    }

    /**
     * @dev See {IERC20-approve}.
     *
     * NOTE: If `amount` is the maximum `uint256`, the allowance is not updated on
     * `transferFrom`. This is semantically equivalent to an infinite approval.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     */
    function approve(address spender, uint256 amount) public virtual override returns (bool) {
        if (spender == address(0)) revert ZeroAddress();
        if (amount == type(uint256).max) {
            _allow(msg.sender, spender, true);
        } else if (amount == 0) {
            _allow(msg.sender, spender, false);
        } else {
            revert BadAmount();
        }
        return true;
    }

    /**
     * @dev See {IERC20-transferFrom}.
     *
     * Emits an {Approval} event indicating the updated allowance. This is not
     * required by the EIP. See the note at the beginning of {ERC20}.
     *
     * NOTE: Does not update the allowance if the current allowance
     * is the maximum `uint256`.
     *
     * Requirements:
     *
     * - `from` and `to` cannot be the zero address.
     * - `from` must have a balance of at least `amount`.
     * - the caller must be authorized to transfer ``from``'s tokens
     */
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public virtual override returns (bool) {
        if (!hasPermission(from, msg.sender)) revert Unauthorized();
        _transfer(from, to, amount);
        return true;
    }

    /**
     * @dev Moves `amount` of tokens from `from` to `to`.
     *
     * This internal function is equivalent to {transfer}, and can be used to
     * e.g. implement automatic token fees, slashing mechanisms, etc.
     *
     * Emits a {Transfer} event.
     *
     * Requirements:
     *
     * - `from` cannot be the zero address.
     * - `to` cannot be the zero address.
     * - `from` must have a balance of at least `amount`.
     */
    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual {
        if (from == address(0)) revert ZeroAddress();
        if (to == address(0)) revert ZeroAddress();

        _beforeTokenTransfer(from, to, amount);

        uint256 fromBalance = _balances[from];
        if (amount > fromBalance) revert ExceedsBalance(amount);
        unchecked {
            _balances[from] = fromBalance - amount;
        }
        _balances[to] += amount;

        emit Transfer(from, to, amount);
    }

    /** @dev Creates `amount` tokens and assigns them to `account`, increasing
     * the total supply.
     *
     * Emits a {Transfer} event with `from` set to the zero address.
     *
     * Requirements:
     *
     * - `account` cannot be the zero address.
     */
    function _mint(address account, uint256 amount) internal virtual {
        if (account == address(0)) revert ZeroAddress();

        _totalSupply += amount;
        _balances[account] += amount;
        emit Transfer(address(0), account, amount);
    }

    /**
     * @dev Destroys `amount` tokens from `account`, reducing the
     * total supply.
     *
     * Emits a {Transfer} event with `to` set to the zero address.
     *
     * Requirements:
     *
     * - `account` cannot be the zero address.
     * - `account` must have at least `amount` tokens.
     */
    function _burn(address account, uint256 amount) internal virtual {
        // untestable:
        //      previously validated, account will not be address(0)
        if (account == address(0)) revert ZeroAddress();

        uint256 accountBalance = _balances[account];
        // untestable:
        //      ammount previously capped to the account balance
        if (amount > accountBalance) revert ExceedsBalance(amount);
        unchecked {
            _balances[account] = accountBalance - amount;
        }
        _totalSupply -= amount;

        emit Transfer(account, address(0), amount);
    }

    /**
     * @dev Allow or disallow another address to withdraw, or transfer from the sender.
     *
     * Emits an {Approval} event.
     *
     * Requirements:
     *
     * - `owner` cannot be the zero address.
     * - `manager` cannot be the zero address.
     */
    function allow(address account, bool isAllowed_) external {
        _allow(msg.sender, account, isAllowed_);
    }

    /**
     * @dev Gives `manager` control over the  `owner` s tokens.
     *
     * This internal function is equivalent to `allow`, and can be used to
     * e.g. set automatic allowances for certain subsystems, etc.
     *
     * Emits an {Approval} event.
     *
     * Requirements:
     *
     * - `owner` cannot be the zero address.
     * - `manager` cannot be the zero address.
     */
    function _allow(
        address owner,
        address manager,
        bool isAllowed_
    ) internal {
        if (owner == address(0)) revert ZeroAddress();
        if (manager == address(0)) revert ZeroAddress();

        isAllowed[owner][manager] = isAllowed_;
        emit Approval(owner, manager, isAllowed_ ? type(uint256).max : 0);
    }

    /**
     * @dev Determine if the `manager` has permission to act on behalf of the `owner`.
     */
    function hasPermission(address owner, address manager) public view returns (bool) {
        return owner == manager || isAllowed[owner][manager];
    }

    /**
     * @dev Hook that is called before any transfer of tokens. This does not include
     * minting and burning.
     *
     * Calling conditions:
     *
     * - when `from` and `to` are both non-zero, `amount` of ``from``'s tokens
     * will be transferred to `to`.
     * - when `from` is zero, `amount` tokens will be minted for `to`.
     * - when `to` is zero, `amount` of ``from``'s tokens will be burned.
     * - `from` and `to` are never both zero.
     */
    // solhint-disable no-empty-blocks
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual {}
}
