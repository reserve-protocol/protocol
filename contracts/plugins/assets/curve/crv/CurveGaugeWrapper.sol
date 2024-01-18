// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../erc20/RewardableERC20Wrapper.sol";

//slither-disable-next-line name-reused
interface IMinter {
    /// Mint CRV to msg.sender based on their prorata share of the provided gauge
    function mint(address gaugeAddr) external;
}

interface ILiquidityGauge {
    function deposit(uint256 _value) external;

    /// @param _value LP token amount
    function withdraw(uint256 _value) external;
}

// Note: Only supports CRV rewards. If a Curve pool with multiple reward tokens is
// used, other reward tokens beyond CRV will never be claimed and distributed to
// depositors. These unclaimed rewards will be lost forever.

// In addition to this, each wrapper deployment must be tested individually, regardless
// of the number of reward tokens it has. This contract is not compatible with all gauges
// and may revert depending on the Curve Gauge being used. For example, the
// `RewardsOnlyGauge` does not have a user_checkpoint() function, which means the
// MINTER.mint() call in this contract would revert in that case.

contract CurveGaugeWrapper is RewardableERC20Wrapper {
    using SafeERC20 for IERC20;

    IMinter public constant MINTER = IMinter(0xd061D61a4d941c39E5453435B6345Dc261C2fcE0);

    ILiquidityGauge public immutable gauge;

    /// @param _lpToken The curve LP token, transferrable
    constructor(
        ERC20 _lpToken,
        string memory _name,
        string memory _symbol,
        ERC20 _crv,
        ILiquidityGauge _gauge
    ) RewardableERC20Wrapper(_lpToken, _name, _symbol, _crv) {
        gauge = _gauge;
    }

    // deposit a curve token
    function _afterDeposit(uint256 _amount, address) internal override {
        underlying.approve(address(gauge), _amount);
        gauge.deposit(_amount);
    }

    // withdraw to curve token
    function _beforeWithdraw(uint256 _amount, address) internal override {
        gauge.withdraw(_amount);
    }

    // claim rewards - only supports CRV rewards, may not work for all gauges
    function _claimAssetRewards() internal virtual override {
        MINTER.mint(address(gauge));
    }
}
