pragma solidity 0.8.4;

import "../interfaces/IConfiguration.sol";
import "../interfaces/ICircuitBreaker.sol";
import "../zeppelin/token/ERC20.sol";

/*
 * @title SlowMintingERC20 
 * @dev An ERC20 that time-delays minting events, causing the internal balance mapping 
 * of the contract to update only after an appropriate delay. 
 * 
 * The delay is determined using a FIFO minting queue. The queue stores the block of the initial 
 * minting event. As the block number increases, mintings are taken off the queue and paid out. 
 *
 * *Contract Invariant*
 * At any reasonable setting of values this algorithm should not result in the queue growing 
 * unboundedly. In the worst case this does occur, portions of the queue can be processed 
 * manually by calling `processMintings` directly. 
 */ 
contract SlowMintingERC20 is ERC20 {

    IConfiguration public override conf;

    struct Minting {
        uint256 blockStart;
        uint256 amount;
        address account;
    }

    Minting[] public override mintings;
    uint256 public override lastMinting;

    event MintingComplete(address account, uint256 amount);

    constructor(
        string calldata name_, 
        string calldata symbol_, 
        address calldata conf_,
    ) ERC20(name_, symbol_) public {
        conf = IConfiguration(conf_);
    }


    modifier update() {
        processMintings(mintings.length - lastMinting);
        _;
    }


    /// Tries to process `count` mintings. Called before most actions.
    /// Can also be called directly if we get to the block gas limit. 
    function processMintings(uint32 count) public override {
        if (!ICircuitBreaker(conf.params.circuitBreakerAddress).check()) {
            uint32 blocksToVest = block.number - m.blockStart;
            uint32 i = lastMinting;
            while (i < min(mintings.length, lastMinting + count)) {
                Minting storage m = mintings[i];
                // Break if the next minting is too big.
                if (m.amount > conf.params.issuanceBlockLimit * (blocksToVest)) {
                    break
                }

                uint256 blocksUsed = m.amount / conf.params.issuanceBlockLimit;
                if (blocksUsed * conf.params.issuanceBlockLimit > m.amount) {
                    blocksUsed = blocksUsed + 1;
                }
                blocksToVest = blocksToVest - blocksUsed;

                // Time-delayed balance/supply changes
                _balances[account] += m.amount;
                _totalSupply += m.amount;
                emit MintingComplete(m.account, m.amount);

                i++;
                delete m; // gas saving
            }

            lastMinting = i;
        }
    }

    /**
     * @dev See {IERC20-totalSupply}.
     */
    function totalSupply() public view virtual override update returns (uint256) {
        return _totalSupply;
    }

    /**
     * @dev See {IERC20-balanceOf}.
     */
    function balanceOf(address account) public view virtual override update returns (uint256) {
        return _balances[account];
    }

    /**
     * @dev See {IERC20-transfer}.
     *
     * Requirements:
     *
     * - `recipient` cannot be the zero address.
     * - the caller must have a balance of at least `amount`.
     */
    function transfer(address recipient, uint256 amount) public virtual override update returns (bool) {
        _transfer(_msgSender(), recipient, amount);
        return true;
    }

    /**
     * @dev See {IERC20-transferFrom}.
     *
     * Emits an {Approval} event indicating the updated allowance. This is not
     * required by the EIP. See the note at the beginning of {ERC20}.
     *
     * Requirements:
     *
     * - `sender` and `recipient` cannot be the zero address.
     * - `sender` must have a balance of at least `amount`.
     * - the caller must have allowance for ``sender``'s tokens of at least
     * `amount`.
     */
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public virtual override update returns (bool) {
        _transfer(sender, recipient, amount);

        uint256 currentAllowance = _allowances[sender][_msgSender()];
        require(currentAllowance >= amount, "ERC20: transfer amount exceeds allowance");
        unchecked {
            _approve(sender, _msgSender(), currentAllowance - amount);
        }

        return true;
    }

    /** @dev Creates `amount` tokens and assigns them to `account`, increasing
     * the total supply.
     *
     * Emits a {Transfer} event with `from` set to the zero address.
     *
     * Requirements:
     *
     * - `account` cannot be the zero address.
     * 
     * Instead of immediately crediting balances, balances increase in 
     * the future based on conf.params.issuanceBlockLimit.
     */
    function _mint(address account, uint256 amount) internal virtual override {
        require(account != address(0), "ERC20: mint to the zero address");

        _beforeTokenTransfer(address(0), account, amount);

        Minting storage m = Minting(block.number, amount);
        mintings.push(m);
    }
}
