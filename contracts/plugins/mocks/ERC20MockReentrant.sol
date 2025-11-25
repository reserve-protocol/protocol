// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import "@openzeppelin/contracts/utils/Address.sol";
import "./ERC20Mock.sol";
import "../../interfaces/IMain.sol";

contract ERC20MockReentrant is ERC20Mock {
    bool private _reenter;
    address private _reentryTarget;
    bytes private _reentryCall;

    constructor(string memory name, string memory symbol) ERC20Mock(name, symbol) {
        _reenter = false;
    }

    function setReenter(bool value) external {
        _reenter = value;
    }

    function setReentryCall(address target, bytes calldata call) external {
        _reentryTarget = target;
        _reentryCall = call;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public override returns (bool) {
        _reentrancy();
        return super.transferFrom(from, to, amount);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        _reentrancy();
        return super.transfer(to, amount);
    }

    function approve(address spender, uint256 amount) public override returns (bool) {
        _reentrancy();
        return super.approve(spender, amount);
    }

    // Mock function only used for testing claimRewards
    function claimRewards() public {
        _reentrancy();
    }

    function _reentrancy() private {
        if (_reenter && _reentryCall.length > 0 && _reentryTarget != address(0)) {
            Address.functionCall(_reentryTarget, _reentryCall); // bubble revert
        }
    }
}
