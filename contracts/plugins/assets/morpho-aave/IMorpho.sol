// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

interface IMorpho {
    function supply(address _poolToken, uint256 _amount) external;
    function withdraw(address _poolToken, uint256 _amount) external;
}

interface UsersLens {
    function getCurrentSupplyBalanceInOf(address _poolToken, address _user)
        external
        view
        returns (
            uint256 balanceInP2P,
            uint256 balanceOnPool,
            uint256 totalBalance
        );
}
