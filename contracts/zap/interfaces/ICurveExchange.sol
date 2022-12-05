// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface ICurveExchange {
    function get_best_rate(
        address _from,
        address _to,
        uint256 _amount
    ) external view returns (address, uint256);

    function get_best_rate(
        address _from,
        address _to,
        uint256 _amount,
        address[] calldata _excludePools
    ) external view returns (address, uint256);

    function exchange(
        address _pool,
        address _from,
        address _to,
        uint256 _amount,
        uint256 _expected,
        address _receiver
    ) external payable returns (uint256);

    function exchange_multiple(
        address[9] calldata _pools,
        uint256[3][4] calldata _swapParams,
        uint256 _amount,
        uint256 _expected
    ) external payable returns (uint256);
}

interface ICurvePool {
    function coins(uint256 arg0) external view returns (address);
}
