// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.17;

import "../../vendor/solmate/ERC20Solmate.sol";
import "../assets/compoundv2/CTokenVault.sol";
import "../assets/compoundv2/ICToken.sol";

contract CTokenVaultMock is CTokenVault {
    constructor(
        ERC20Solmate _asset,
        string memory _name,
        string memory _symbol,
        ERC20Solmate _rewardToken,
        IComptroller _comptroller
    ) CTokenVault(_asset, _name, _symbol, _rewardToken, _comptroller) {}

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
