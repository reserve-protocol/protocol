// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface IZapRouter {

    /// @param _from Token to swap from
    /// @param _to Token to swap into
    /// @param _amount Amount of token _from to swap
    /// @return received Amount of token _to received from swap
    function swap(
        address _from,
        address _to,
        uint256 _amount
    ) external returns (uint256 received);
}
