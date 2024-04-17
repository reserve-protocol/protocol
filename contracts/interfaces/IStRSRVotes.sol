// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/governance/utils/IVotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/interfaces/IERC5805Upgradeable.sol";

interface IStRSRVotes is IVotesUpgradeable, IERC5805Upgradeable {
    /// @return The current era
    function currentEra() external view returns (uint256);

    /// @return The era at a past block number
    function getPastEra(uint256 timepoint) external view returns (uint256);

    /// Stakes an RSR `amount` on the corresponding RToken and allows to delegate
    /// votes from the sender to `delegatee` or self
    function stakeAndDelegate(uint256 amount, address delegatee) external;
}
