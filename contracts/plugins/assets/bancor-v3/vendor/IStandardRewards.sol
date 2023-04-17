// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

struct ProgramData {
    uint256 id;
    address pool;
    address poolToken;
    address rewardsToken;
    bool isPaused;
    uint32 startTime;
    uint32 endTime;
    uint256 rewardRate;
    uint256 remainingRewards;
}

interface IStandardRewards {
    /**
     * @dev returns all program ids
     */
    function programIds() external view returns (uint256[] memory);

    /**
     * @dev returns program data for each specified program id
     */
    function programs(uint256[] calldata ids) external view returns (ProgramData[] memory);

    /**
     * @dev returns whether the specified program is active
     */
    function isProgramActive(uint256 id) external view returns (bool);

    /**
     * @dev returns whether the specified program is paused
     */
    function isProgramPaused(uint256 id) external view returns (bool);

    /**
     * @dev returns the ID of the latest program for a given pool (or 0 if there's no program)
     */
    function latestProgramId(address pool) external view returns (uint256);

    /**
     * @dev claims rewards and returns the claimed reward amount
     */
    function claimRewards(uint256[] calldata ids) external returns (uint256);
}
