// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/plugins/yearn/IPriceProvider.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/OracleLib.sol";

contract PriceProviderMock is IPriceProvider {
    mapping(address => uint192) public assetFeed;

    constructor() {}

    function price(address asset_) external view virtual override returns (uint256) {
        return assetFeed[asset_];
    }

    function setPrice(address asset_, uint192 price_) external {
        assetFeed[asset_] = price_;
    }

    function decimals() external pure override returns (uint8) {
        return FIX_DECIMALS;
    }
}
