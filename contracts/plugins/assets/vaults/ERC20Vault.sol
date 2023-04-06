// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.17;

import "../../../interfaces/IRewardable.sol";
import "../../../vendor/solmate/ERC4626.sol";
import "../../../vendor/solmate/ERC20Solmate.sol";
import "../../../vendor/solmate/SafeTransferLib.sol";

contract ERC20Vault is IRewardable, ERC4626 {
    using SafeTransferLib for ERC20Solmate;

    constructor(
        ERC20Solmate _asset,
        string memory _name,
        string memory _symbol
    ) ERC4626(_asset, _name, _symbol) {
    }

    function claimRewards() external {
        emit RewardsClaimed(IERC20(0x0000000000000000000000000000000000000000), 0);
    }

    function totalAssets() public view virtual override returns (uint256) {
        return totalSupply;
    }
}
