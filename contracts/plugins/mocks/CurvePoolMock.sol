// SPDX-License-Identifier: ISC
pragma solidity 0.8.19;

import "../../plugins/assets/curve/PoolTokens.sol";

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

    function claim_admin_fees() external {}

    function remove_liquidity(
        uint256 _amount,
        uint256[2] calldata min_amounts,
        bool use_eth,
        address receiver
    ) external {}

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

interface ICurvePoolVariantInt {
    // For Curve Plain Pools and V2 Metapools
    function coins(int128) external view returns (address);

    // Only exists in Curve Lending Pools
    function underlying_coins(int128) external view returns (address);

    // Uses int128 as index
    function balances(int128) external view returns (uint256);

    function get_virtual_price() external view returns (uint256);
}

// Required for some Curve Pools that use int128 as index
contract CurvePoolMockVariantInt is ICurvePoolVariantInt {
    uint256[] internal _balances;
    address[] internal _coins;
    address[] internal _underlying_coins;
    uint256 public get_virtual_price;

    constructor(uint256[] memory initialBalances, address[] memory initialCoins) {
        _balances = initialBalances;
        _coins = initialCoins;
    }

    function setBalances(uint256[] memory newBalances) external {
        _balances = newBalances;
    }

    function balances(int128 index) external view returns (uint256) {
        uint256 newIndex = uint256(abs(index));
        return _balances[newIndex];
    }

    function coins(int128 index) external view returns (address) {
        uint256 newIndex = uint256(abs(index));
        return _coins[newIndex];
    }

    function underlying_coins(int128 index) external view returns (address) {
        uint256 newIndex = uint256(abs(index));
        return _underlying_coins[newIndex];
    }

    function setVirtualPrice(uint256 newPrice) external {
        get_virtual_price = newPrice;
    }
}
