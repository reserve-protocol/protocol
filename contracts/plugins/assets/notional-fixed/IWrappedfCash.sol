// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IWrappedfCash {
    function mintViaUnderlying(
        uint256 depositAmountExternal,
        uint88 fCashAmount,
        address receiver,
        uint32 minImpliedRate
    ) external;

    function redeemToUnderlying(uint256 amount, address receiver, uint32 maxImpliedRate) external;

    /// @notice Returns the underlying fCash maturity of the token
    function getMaturity() external view returns (uint40 maturity);

    /// @notice True if the fCash has matured, assets mature exactly on the block time
    function hasMatured() external view returns (bool);

    /// @notice fCash is always denominated in 8 decimal places
    function decimals() external pure returns (uint8);
}

