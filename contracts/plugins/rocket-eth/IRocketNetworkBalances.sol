// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

// See contracts/interface/network/RocketNetworkBalancesInterface.sol
interface IRocketNetworkBalances {
    function getBalancesBlock() external view returns (uint256);

    function getLatestReportableBlock() external view returns (uint256);

    function getTotalETHBalance() external view returns (uint256);

    function setTotalETHBalance(uint256 _value) external;

    function getStakingETHBalance() external view returns (uint256);

    function getTotalRETHSupply() external view returns (uint256);

    function getETHUtilizationRate() external view returns (uint256);

    function submitBalances(
        uint256 _block,
        uint256 _total,
        uint256 _staking,
        uint256 _rethSupply
    ) external;

    function executeUpdateBalances(
        uint256 _block,
        uint256 _totalEth,
        uint256 _stakingEth,
        uint256 _rethSupply
    ) external;
}
