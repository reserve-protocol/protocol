// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../erc20/RewardableERC20Wrapper.sol";
import "./ICToken.sol";

contract CTokenWrapper is RewardableERC20Wrapper {
    using SafeERC20 for ERC20;

    IComptroller public immutable comptroller;

    constructor(
        ERC20 _asset,
        string memory _name,
        string memory _symbol,
        IComptroller _comptroller
    ) RewardableERC20Wrapper(_asset, _name, _symbol, ERC20(_comptroller.getCompAddress())) {
        comptroller = _comptroller;
    }

    function _claimAssetRewards() internal virtual override {
        comptroller.claimComp(address(this));
    }

    // No overrides of _deposit()/_withdraw() necessary: no staking required
}
