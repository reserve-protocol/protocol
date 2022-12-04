// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface ICurveExchange {
    function get_best_rate(address _from, address _to, uint256 _amount) external view returns (address, uint256);

    function get_best_rate(address _from, address _to, uint256 _amount, address[] calldata _exclude_pools) external view returns (address, uint256);

    function exchange(address _pool, address _from, address _to, uint256 _amount, uint256 _expected, address _receiver) external payable returns (uint256);
}
