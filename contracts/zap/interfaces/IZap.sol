// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface IZap {
    function zapIn(address _from, address _to,  uint256 _amount) external returns (uint256 received);

    function zapOut(address _from, address _to,  uint256 _amount) external returns (uint256 received);
}
