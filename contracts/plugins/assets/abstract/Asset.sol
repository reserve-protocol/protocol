// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/libraries/Fixed.sol";

abstract contract Asset is IAsset {
    using FixLib for int192;

    IERC20Metadata public immutable erc20;

    uint256 public immutable maxTradeVolume; // {UoA}

    constructor(IERC20Metadata erc20_, uint256 maxTradeVolume_) {
        erc20 = erc20_;
        maxTradeVolume = maxTradeVolume_;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual returns (int192);

    /// @return {tok} The balance of the ERC20 in whole tokens
    function bal(address account) external view returns (int192) {
        return toFixWithShift(erc20.balanceOf(account), -int8(erc20.decimals()));
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure virtual returns (bool) {
        return false;
    }

    /// (address, calldata) to call in order to claim rewards for holding this asset
    /// @dev The default impl returns zero values, implying that no reward function exists.
    // solhint-disable-next-line no-empty-blocks
    function getClaimCalldata() external view virtual returns (address _to, bytes memory _cd) {}

    /// The IERC20 token address that this Asset's rewards are paid in.
    /// @dev The default impl returns zero values, implying that no reward function exists.
    // solhint-disable-next-line no-empty-blocks
    function rewardERC20() external view virtual returns (IERC20 reward) {}
}
