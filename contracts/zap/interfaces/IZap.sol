// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface IZap {

    /// @param _from Token to zap out from into rToken
    /// @param _to rToken to zap out into
    /// @param _amount Amount of token _from to zap in
    /// @return received Amount of token _to received from zap in
    function zapIn(
        address _from,
        address _to,
        uint256 _amount
    ) external returns (uint256 received);

    /// @param _from rToken to zap out out of
    /// @param _to Token to zap out into
    /// @param _amount Amount of token _from to zap out
    /// @return received Amount of token _to received from zap out
    function zapOut(
        address _from,
        address _to,
        uint256 _amount
    ) external returns (uint256 received);
}
