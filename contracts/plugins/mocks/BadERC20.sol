// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/utils/Address.sol";
import "../../libraries/Fixed.sol";
import "./ERC20Mock.sol";

contract BadERC20 is ERC20Mock {
    using Address for address;
    using FixLib for uint192;
    uint192 public transferFee; // {1}

    bool public revertDecimals;

    mapping(address => bool) public censored;

    constructor(string memory name, string memory symbol) ERC20Mock(name, symbol) {}

    function setTransferFee(uint192 newFee) external {
        transferFee = newFee;
    }

    function setRevertDecimals(bool newVal) external {
        revertDecimals = newVal;
    }

    function setCensored(address account, bool val) external {
        censored[account] = val;
    }

    function decimals() public view override returns (uint8) {
        bytes memory data = abi.encodePacked((bytes4(keccak256("absentDecimalsFn()"))));

        // Make an external staticcall to this address, for a function that does not exist
        if (revertDecimals) address(this).functionStaticCall(data, "No Decimals");
        return 18;
    }

    function transfer(address to, uint256 amount) public virtual override returns (bool) {
        address owner = _msgSender();
        if (censored[owner] || censored[to]) revert("censored");
        uint256 fee = transferFee.mulu_toUint(amount, CEIL);
        _transfer(owner, to, amount - fee);
        _burn(owner, fee);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public virtual override returns (bool) {
        address spender = _msgSender();
        if (censored[from] || censored[to]) revert("censored");
        _spendAllowance(from, spender, amount);
        uint256 fee = transferFee.mulu_toUint(amount, CEIL);
        _transfer(from, to, amount - fee);
        _burn(from, fee);
        return true;
    }
}
