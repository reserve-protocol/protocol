// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "./IClaimAdapter.sol";
import "./IComponent.sol";

interface IRewardClaimerEvents {
    /// Emitted whenever rewards are claimed
    event RewardsClaimed(IERC20Metadata indexed erc20, uint256 indexed amount);
}

interface IRewardClaimer is IRewardClaimerEvents, IComponent {
    /// Emitted whenever a claim adapter is added by governance
    event ClaimAdapterAdded(IClaimAdapter indexed adapter);
    /// Emitted whenever a claim adapter is removed by governance
    event ClaimAdapterRemoved(IClaimAdapter indexed adapter);

    function claimRewards() external;

    function addClaimAdapter(IClaimAdapter claimAdapter) external;

    function removeClaimAdapter(IClaimAdapter claimAdapter) external;

    function isTrustedClaimAdapter(IClaimAdapter claimAdapter_) external view returns (bool);

    function claimAdapters() external view returns (IClaimAdapter[] memory adapters);
}
