// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/IMain.sol";
import "./AssetP0.sol";

contract ATokenAssetP0 is AssetP0 {
    // All aTokens have 18 decimals.
    constructor(address erc20_) AssetP0(erc20_) {}

    function redemptionRate() public view override returns (uint256) {
        return IStaticAToken(address(erc20())).rate() * 10**(18 - fiatcoinDecimals());
    }

    function fiatcoin() public view override returns (address) {
        return IStaticAToken(address(erc20())).ATOKEN().UNDERLYING_ASSET_ADDRESS();
    }

    function isFiatcoin() external pure override returns (bool) {
        return false;
    }
}
