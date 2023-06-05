// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../RewardableERC20Vault.sol";

interface IMinter {
    /// Mint CRV to msg.sender based on their prorata share of the provided gauge
    function mint(address gaugeAddr) external;
}

interface ILiquidityGauge {
    /// @param _value LP token amount
    function deposit(uint256 _value) external;

    /// @param _value LP token amount
    function withdraw(uint256 _value) external;
}

contract CurveVault is RewardableERC20Vault {
    using SafeERC20 for IERC20;

    IMinter public immutable minter;

    ILiquidityGauge public immutable gauge;

    /// @param _asset RewardableERC20Vault
    constructor(
        ERC20 _asset,
        string memory _name,
        string memory _symbol,
        ERC20 _crv,
        IMinter _minter,
        ILiquidityGauge _gauge
    ) RewardableERC20Vault(_asset, _name, _symbol, _crv) {
        minter = _minter;
        gauge = _gauge;
    }

    /// Typical deposit logic + stake in the gauge to earn CRV
    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal virtual override {
        super._deposit(caller, receiver, assets, shares);

        // do not need to safeApprove(0) first: _asset is LP token, never raw USDT
        IERC20(asset()).safeApprove(address(gauge), assets);
        gauge.deposit(assets); // ERC4626._deposit()
    }

    /// Typical withdraw logic + stake in the gauge to earn CRV
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal virtual override {
        gauge.withdraw(assets);

        super._withdraw(caller, receiver, owner, assets, shares); // ERC4626._withdraw()
    }

    function _claimAssetRewards() internal virtual override {
        minter.mint(address(gauge));
    }
}
