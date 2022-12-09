// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./IPriceProvider.sol";
import "../assets/OracleLib.sol";
import "contracts/libraries/Fixed.sol";

contract ChainlinkPriceProvider is IPriceProvider, Ownable {
    using OracleLib for AggregatorV3Interface;

    mapping(address => address) public assetFeed;
    uint48 public immutable oracleTimeout;

    constructor(uint48 oracleTimeout_) {
        require(oracleTimeout_ > 0, "oracleTimeout zero");
        oracleTimeout = oracleTimeout_;
    }

    function price(address asset_) external view override returns (uint256) {
        require(assetFeed[asset_] != address(0), "asset not registered");
        return AggregatorV3Interface(assetFeed[asset_]).price(oracleTimeout);
    }

    function decimals() external pure override returns (uint8) {
        return FIX_DECIMALS;
    }

    function registerAssetFeed(address asset_, address feed_) external onlyOwner {
        assetFeed[asset_] = feed_;
    }
}
