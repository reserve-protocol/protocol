// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// Portion of external interface for CTokens
// See: https://github.com/compound-finance/compound-protocol/blob/master/contracts/CToken.sol
interface ICToken is IERC20Metadata {
    /// @dev From Compound Docs:
    /// The current (up to date) exchange rate, scaled by 10^(18 - 8 + Underlying Token Decimals).
    function exchangeRateCurrent() external returns (uint256);

    /// @dev From Compound Docs: The stored exchange rate, with 18 - 8 + UnderlyingAsset.Decimals.
    function exchangeRateStored() external view returns (uint256);

    /// @return The address of the underlying token
    function underlying() external view returns (address);
}

interface IComptroller {
    /// Claim comp for an account, to an account
    function claimComp(address account) external;

    /// @return The address for COMP token
    function getCompAddress() external view returns (address);
}
