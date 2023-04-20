// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.17;

import "../../vendor/solmate/ERC20Solmate.sol";
import "../assets/compoundv2/CTokenVault.sol";
import "../assets/compoundv2/ICToken.sol";
import "./CTokenMock.sol";

contract CTokenVaultMock is CTokenVault {
    constructor(
        ERC20Solmate _asset,
        string memory _name,
        string memory _symbol,
        IComptroller _comptroller
    ) CTokenVault(_asset, _name, _symbol, _comptroller) {}

    function mint(address recipient, uint256 amount) external {
        mint(amount, recipient);
    }


    function setExchangeRate(uint192 fiatcoinRedemptionRate) external {
        CTokenMock(address(asset)).setExchangeRate(fiatcoinRedemptionRate);
    }


    function burn(address sender, uint256 amount) external {
        _burn(sender, amount);
    }

    function adminApprove(
        address owner,
        address spender,
        uint256 amount
    ) external {
        allowance[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }
}
