// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

import "../PoolTokens.sol";

contract CurvePoolMock is ICurvePool {
    uint256[] internal _balances;
    address[] public coins;
    address[] public underlying_coins;
    address[] public base_coins;

    constructor(uint256[] memory intialBalances, address[] memory _coins) {
        _balances = intialBalances;
        coins = _coins;
    }

    function setBalances(uint256[] memory newBalances) external {
        _balances = newBalances;
    }

    function balances(uint256 index) external view returns (uint256) {
        return _balances[index];
    }

    function get_virtual_price() external pure returns (uint256) {
        return 1;
    }

    function token() external pure returns (address) {
        return address(0);
    }

    function exchange(
        int128,
        int128,
        uint256,
        uint256
    ) external {}
}
