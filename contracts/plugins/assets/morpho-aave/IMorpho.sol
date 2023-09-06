// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { IERC20Metadata } from "../erc20/RewardableERC4626Vault.sol";
import { IERC4626 } from "../../../vendor/oz/IERC4626.sol";

interface IMorpho {
    function supply(address _poolToken, uint256 _amount) external;

    function supply(
        address _poolToken,
        address _onBehalf,
        uint256 _amount
    ) external;

    function withdraw(address _poolToken, uint256 _amount) external;
}

interface IMorphoRewardsDistributor {
    function claim(
        address _account,
        uint256 _claimable,
        bytes32[] calldata _proof
    ) external;
}

// Used by Morphos Aave V2 and Compound V2 vaults
interface IMorphoUsersLens {
    function getCurrentSupplyBalanceInOf(address _poolToken, address _user)
        external
        view
        returns (
            uint256 balanceInP2P,
            uint256 balanceOnPool,
            uint256 totalBalance
        );
}

interface IMorphoToken is IERC20Metadata {
    function setPublicCapability(bytes4 functionSig, bool enabled) external;

    function setUserRole(
        address user,
        uint8 role,
        bool enabled
    ) external;

    function setRoleCapability(
        uint8 role,
        bytes4 functionSig,
        bool enabled
    ) external;
}
