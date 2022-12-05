// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface IZapRouter {
    function swap(
        address _from,
        address _to,
        uint256 _amount
    ) external returns (uint256 received);
}
