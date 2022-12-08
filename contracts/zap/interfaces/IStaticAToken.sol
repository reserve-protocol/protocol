// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface IStaticAToken {
    function ASSET() external view returns (address);

    function ATOKEN() external view returns (address);

    function deposit(
        address _recipient,
        uint256 _amount,
        uint16 _referralCode,
        bool _fromUnderlying
    ) external returns (uint256);

    function withdraw(
        address _recipient,
        uint256 _amount,
        bool toUnderlying
    ) external returns (uint256, uint256);
}
