/**
 * This represents our second RSV deployment, which can be found here: 
 *     https://etherscan.io/token/0x196f4727526eA7FB1e17b2071B3d8eAA38486988
*/

pragma solidity 0.5.7;

import "../zeppelin/token/ERC20/IERC20.sol";
import "../zeppelin/math/SafeMath.sol";
import "../ownership/Ownable.sol";
import "../rsv/ReserveEternalStorage.sol";
import "../rsv/Reserve.sol";

contract PreviousReserve is IERC20, Ownable {
    using SafeMath for uint256;


    // ==== State ====


    // Non-constant-sized data
    ReserveEternalStorage internal trustedData;

    // TX Fee helper contract
    ITXFee public trustedTxFee;

    // Basic token data
    uint256 public totalSupply;
    uint256 public maxSupply;

    // Paused data
    bool public paused;

    // Auth roles
    address public minter;
    address public pauser;
    address public feeRecipient;


    // ==== Events, Constants, and Constructor ====


    // Auth role change events
    event MinterChanged(address indexed newMinter);
    event PauserChanged(address indexed newPauser);
    event FeeRecipientChanged(address indexed newFeeRecipient);
    event MaxSupplyChanged(uint256 indexed newMaxSupply);
    event EternalStorageTransferred(address indexed newReserveAddress);
    event TxFeeHelperChanged(address indexed newTxFeeHelper);

    // Pause events
    event Paused(address indexed account);
    event Unpaused(address indexed account);

    // Basic information as constants
    string public constant name = "Reserve";
    string public constant symbol = "RSV";
    uint8 public constant decimals = 18;

    /// Initialize critical fields.
    constructor() public {
        pauser = msg.sender;
        feeRecipient = msg.sender;
        // minter defaults to the zero address.

        maxSupply = 2 ** 256 - 1;
        paused = true;

        trustedTxFee = ITXFee(address(0));
        trustedData = new ReserveEternalStorage();
        trustedData.nominateNewOwner(msg.sender);
    }

    /// Accessor for eternal storage contract address.
    function getEternalStorageAddress() external view returns(address) {
        return address(trustedData);
    }


    // ==== Admin functions ====


    /// Modifies a function to only run if sent by `role`.
    modifier only(address role) {
        require(msg.sender == role, "unauthorized: not role holder");
        _;
    }

    /// Modifies a function to only run if sent by `role` or the contract's `owner`.
    modifier onlyOwnerOr(address role) {
        require(msg.sender == owner() || msg.sender == role, "unauthorized: not owner or role");
        _;
    }

    /// Change who holds the `minter` role.
    function changeMinter(address newMinter) external onlyOwnerOr(minter) {
        minter = newMinter;
        emit MinterChanged(newMinter);
    }

    /// Change who holds the `pauser` role.
    function changePauser(address newPauser) external onlyOwnerOr(pauser) {
        pauser = newPauser;
        emit PauserChanged(newPauser);
    }

    function changeFeeRecipient(address newFeeRecipient) external onlyOwnerOr(feeRecipient) {
        feeRecipient = newFeeRecipient;
        emit FeeRecipientChanged(newFeeRecipient);
    }

    /// Make a different address the EternalStorage contract's reserveAddress.
    /// This will break this contract, so only do it if you're
    /// abandoning this contract, e.g., for an upgrade.
    function transferEternalStorage(address newReserveAddress) external onlyOwner isPaused {
        require(newReserveAddress != address(0), "zero address");
        emit EternalStorageTransferred(newReserveAddress);
        trustedData.updateReserveAddress(newReserveAddress);
    }

    /// Change the contract that helps with transaction fee calculation.
    function changeTxFeeHelper(address newTrustedTxFee) external onlyOwner {
        trustedTxFee = ITXFee(newTrustedTxFee);
        emit TxFeeHelperChanged(newTrustedTxFee);
    }

    /// Change the maximum supply allowed.
    function changeMaxSupply(uint256 newMaxSupply) external onlyOwner {
        maxSupply = newMaxSupply;
        emit MaxSupplyChanged(newMaxSupply);
    }

    /// Pause the contract.
    function pause() external only(pauser) {
        paused = true;
        emit Paused(pauser);
    }

    /// Unpause the contract.
    function unpause() external only(pauser) {
        paused = false;
        emit Unpaused(pauser);
    }

    /// Modifies a function to run only when the contract is paused.
    modifier isPaused() {
        require(paused, "contract is not paused");
        _;
    }

    /// Modifies a function to run only when the contract is not paused.
    modifier notPaused() {
        require(!paused, "contract is paused");
        _;
    }


    // ==== Token transfers, allowances, minting, and burning ====


    /// @return how many attoRSV are held by `holder`.
    function balanceOf(address holder) external view returns (uint256) {
        return trustedData.balance(holder);
    }

    /// @return how many attoRSV `holder` has allowed `spender` to control.
    function allowance(address holder, address spender) external view returns (uint256) {
        return trustedData.allowed(holder, spender);
    }

    /// Transfer `value` attoRSV from `msg.sender` to `to`.
    function transfer(address to, uint256 value)
        external
        notPaused
        returns (bool)
    {
        _transfer(msg.sender, to, value);
        return true;
    }

    /**
     * Approve `spender` to spend `value` attotokens on behalf of `msg.sender`.
     *
     * Beware that changing a nonzero allowance with this method brings the risk that
     * someone may use both the old and the new allowance by unfortunate transaction ordering. One
     * way to mitigate this risk is to first reduce the spender's allowance
     * to 0, and then set the desired value afterwards, per
     * [this ERC-20 issue](https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729).
     *
     * A simpler workaround is to use `increaseAllowance` or `decreaseAllowance`, below.
     *
     * @param spender address The address which will spend the funds.
     * @param value uint256 How many attotokens to allow `spender` to spend.
     */
    function approve(address spender, uint256 value)
        external
        notPaused
        returns (bool)
    {
        _approve(msg.sender, spender, value);
        return true;
    }

    /// Transfer approved tokens from one address to another.
    /// @param from address The address to send tokens from.
    /// @param to address The address to send tokens to.
    /// @param value uint256 The number of attotokens to send.
    function transferFrom(address from, address to, uint256 value)
        external
        notPaused
        returns (bool)
    {
        _transfer(from, to, value);
        _approve(from, msg.sender, trustedData.allowed(from, msg.sender).sub(value));
        return true;
    }

    /// Increase `spender`'s allowance of the sender's tokens.
    /// @dev From MonolithDAO Token.sol
    /// @param spender The address which will spend the funds.
    /// @param addedValue How many attotokens to increase the allowance by.
    function increaseAllowance(address spender, uint256 addedValue)
        external
        notPaused
        returns (bool)
    {
        _approve(msg.sender, spender, trustedData.allowed(msg.sender, spender).add(addedValue));
        return true;
    }

    /// Decrease `spender`'s allowance of the sender's tokens.
    /// @dev From MonolithDAO Token.sol
    /// @param spender The address which will spend the funds.
    /// @param subtractedValue How many attotokens to decrease the allowance by.
    function decreaseAllowance(address spender, uint256 subtractedValue)
        external
        notPaused
        returns (bool)
    {
        _approve(
            msg.sender,
            spender,
            trustedData.allowed(msg.sender, spender).sub(subtractedValue)
        );
        return true;
    }

    /// Mint `value` new attotokens to `account`.
    function mint(address account, uint256 value)
        external
        notPaused
        only(minter)
    {
        require(account != address(0), "can't mint to address zero");

        totalSupply = totalSupply.add(value);
        require(totalSupply < maxSupply, "max supply exceeded");
        trustedData.addBalance(account, value);
        emit Transfer(address(0), account, value);
    }

    /// Burn `value` attotokens from `account`, if sender has that much allowance from `account`.
    function burnFrom(address account, uint256 value)
        external
        notPaused
        only(minter)
    {
        _burn(account, value);
        _approve(account, msg.sender, trustedData.allowed(account, msg.sender).sub(value));
    }

    /// @dev Transfer of `value` attotokens from `from` to `to`.
    /// Internal; doesn't check permissions.
    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "can't transfer to address zero");
        trustedData.subBalance(from, value);
        uint256 fee = 0;

        if (address(trustedTxFee) != address(0)) {
            fee = trustedTxFee.calculateFee(from, to, value);
            require(fee <= value, "transaction fee out of bounds");

            trustedData.addBalance(feeRecipient, fee);
            emit Transfer(from, feeRecipient, fee);
        }

        trustedData.addBalance(to, value.sub(fee));
        emit Transfer(from, to, value.sub(fee));
    }

    /// @dev Burn `value` attotokens from `account`.
    /// Internal; doesn't check permissions.
    function _burn(address account, uint256 value) internal {
        require(account != address(0), "can't burn from address zero");

        totalSupply = totalSupply.sub(value);
        trustedData.subBalance(account, value);
        emit Transfer(account, address(0), value);
    }

    /// @dev Set `spender`'s allowance on `holder`'s tokens to `value` attotokens.
    /// Internal; doesn't check permissions.
    function _approve(address holder, address spender, uint256 value) internal {
        require(spender != address(0), "spender cannot be address zero");
        require(holder != address(0), "holder cannot be address zero");

        trustedData.setAllowed(holder, spender, value);
        emit Approval(holder, spender, value);
    }
}
