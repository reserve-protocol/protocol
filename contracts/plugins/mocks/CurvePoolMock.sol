// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

import "../../plugins/assets/convex/PoolTokens.sol";

contract CurvePoolMock is ICurvePool {
    uint256[] internal _balances;
    address[] public coins;
    address[] public underlying_coins;
    address[] public base_coins;
    uint256 public get_virtual_price;

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

    function setVirtualPrice(uint256 newPrice) external {
        get_virtual_price = newPrice;
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
