// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "../interfaces/IMain.sol";
import "./AssetP0.sol";

// https://github.com/aave/protocol-v2/blob/feat-atoken-wrapper-liquidity-mining/contracts/protocol/tokenization/StaticATokenLM.sol
interface IStaticAToken is IERC20 {
    function rate() external view returns (uint256);

    function ATOKEN() external view returns (AToken);

    function claimRewardsToSelf(bool forceUpdate) external;
}

interface AToken {
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
}

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
