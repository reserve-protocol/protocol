// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "../libraries/OracleP1.sol";

contract AaveOracleMockP1 is IAaveOracle {
    mapping(address => uint256) private _prices;

    address private _weth;

    constructor(address wethAddress) {
        _weth = wethAddress;
    }

    function setPrice(address token, uint256 price_) external {
        _prices[token] = price_;
    }

    function WETH() external view override returns (address) {
        return _weth;
    }

    function getAssetPrice(address token) external view override returns (uint256) {
        return _prices[token];
    }
}
