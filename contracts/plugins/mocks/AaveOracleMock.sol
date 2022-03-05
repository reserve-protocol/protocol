// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/abstract/AaveOracleMixin.sol";

contract AaveOracleMockP0 is IAaveOracle {
    mapping(address => uint256) private _prices;

    address private _weth;

    constructor(address wethAddress) {
        _weth = wethAddress;
    }

    function setPrice(address token, uint256 price_) external {
        _prices[token] = price_;
    }

    function WETH() external view returns (address) {
        return _weth;
    }

    function getAssetPrice(address token) external view returns (uint256) {
        return _prices[token];
    }
}
