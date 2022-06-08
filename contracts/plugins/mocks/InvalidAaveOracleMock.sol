// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/abstract/AaveOracleMixin.sol";

contract InvalidAaveOracleMock is IAaveOracle {
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

    // Dummy implementation - Reverts - Testing Purposes
    function getAssetPrice(address) external view returns (uint256) {
        revert();

        return 1; // Dummy, never returned
    }
}
