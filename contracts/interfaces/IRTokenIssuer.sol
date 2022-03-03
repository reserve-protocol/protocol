// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "./IComponent.sol";

interface IRTokenIssuer is IComponent {
    /// Emitted when an issuance of RToken begins
    /// @param issuer The address of the account redeeeming RTokens
    /// @param amount The quantity of RToken being issued
    /// @param baskets The corresponding number of baskets
    event IssuanceStarted(address indexed issuer, uint256 indexed amount, Fix indexed baskets);

    /// Emitted when a redemption of RToken occurs
    /// @param redeemer The address of the account redeeeming RTokens
    /// @param amount The quantity of RToken being redeemed
    /// @param baskets The corresponding number of baskets
    event Redemption(address indexed redeemer, uint256 indexed amount, Fix indexed baskets);

    function issue(uint256 amount) external returns (uint256[] memory deposits);

    function redeem(uint256 amount) external returns (uint256[] memory compensation);

    function basketTokens() external view returns (address[] memory);

    function maxIssuable(address account) external view returns (uint256);

    // {UoA/rTok}
    function rTokenPrice() external view returns (Fix p);
}
