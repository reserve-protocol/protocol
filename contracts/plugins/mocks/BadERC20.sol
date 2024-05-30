// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/Address.sol";
import "../../libraries/Fixed.sol";
import "./ERC20Mock.sol";

contract BadERC20 is ERC20Mock {
    using Address for address;
    using FixLib for uint192;
    uint8 private _decimals;
    uint192 public transferFee; // {1}
    bool public revertDecimals;
    bool public revertApprove; // if true, reverts for any approve > 0 and < type(uint256).max

    mapping(address => bool) public censored;

    constructor(string memory name, string memory symbol) ERC20Mock(name, symbol) {
        _decimals = 18;
    }

    function setTransferFee(uint192 newFee) external {
        transferFee = newFee;
    }

    function setDecimals(uint8 newVal) external {
        _decimals = newVal;
    }

    function setRevertDecimals(bool newVal) external {
        revertDecimals = newVal;
    }

    function setCensored(address account, bool val) external {
        censored[account] = val;
    }

    function setRevertApprove(bool newRevertApprove) external {
        revertApprove = newRevertApprove;
    }

    function decimals() public view override returns (uint8) {
        bytes memory data = abi.encodePacked((bytes4(keccak256("absentDecimalsFn()"))));

        // Make an external staticcall to this address, for a function that does not exist
        if (revertDecimals) address(this).functionStaticCall(data, "No Decimals");
        return _decimals;
    }

    function approve(address spender, uint256 amount) public virtual override returns (bool) {
        if (censored[msg.sender] || censored[spender]) revert("censored");
        if (revertApprove && amount > 0 && amount < type(uint256).max) revert("revertApprove");
        return super.approve(spender, amount);
    }

    function transfer(address to, uint256 amount) public virtual override returns (bool) {
        if (censored[msg.sender] || censored[to]) revert("censored");
        uint256 fee = transferFee.mulu_toUint(amount, CEIL);
        _transfer(msg.sender, to, amount - fee);
        _burn(msg.sender, fee);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public virtual override returns (bool) {
        address spender = msg.sender;
        if (censored[spender] || censored[from] || censored[to]) revert("censored");
        _spendAllowance(from, spender, amount);
        uint256 fee = transferFee.mulu_toUint(amount, CEIL);
        _transfer(from, to, amount - fee);
        _burn(from, fee);
        return true;
    }
}
