// SPDX-License-Identifier: ISC
pragma solidity 0.8.19;

interface IConvexStakingWrapper {
    function crv() external returns (address);

    function cvx() external returns (address);

    function getReward(address _account) external;
}
