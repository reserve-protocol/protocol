// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/proto0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "./AssetP0.sol";

// https://github.com/aave/protocol-v2/blob/feat-atoken-wrapper-liquidity-mining/contracts/protocol/tokenization/StaticATokenLM.sol
interface IStaticAToken is IERC20 {
    // @return RAY{fiatTok/tok}
    function rate() external view returns (uint256);

    function ATOKEN() external view returns (AToken);

    function claimRewardsToSelf(bool forceUpdate) external;
}

interface AToken {
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
}

/// @dev In Aave the number of decimals of the staticAToken is always 18, but the underlying rebasing
/// AToken will have the same number of decimals as its fiatcoin.
contract ATokenAssetP0 is AssetP0 {
    using FixLib for Fix;

    constructor(address erc20_) AssetP0(erc20_) {}

    /// Claims any rewards such as COMP/AAVE for the asset
    function claimRewards() external override {
        IStaticAToken(address(erc20())).claimRewardsToSelf(true);
    }

    /// @return {qFiatTok/qTok}
    function rateFiatcoin() public view override returns (Fix) {
        uint256 rateInRAYs = IStaticAToken(_erc20).rate(); // {fiatTok/tok} * 1e27

        // Unit conversions:
        //   1{fiatTok} = 10**fiatcoinDecimals(){qFiatTok}
        //   1{tok} = 10**decimals(){qTok}
        //   1 = 10**27{RAY}

        // {qFiatTok/qTok} = {fiatTok/tok} * 1e27 / 1e27 * {qFiatTok/fiatTok} / {qTok/tok}
        // result = rateInRAYs / 1e27 * 10**fiatcoinDecimals() / 10**decimals();

        int128 shiftLeft = -27 + int8(fiatcoinDecimals()) - int8(decimals());
        return toFix(rateInRAYs, shiftLeft);
    }

    // @return {attoUSD/qTok}
    function rateUSD() public view override returns (Fix) {
        uint256 rateInRAYs = IStaticAToken(_erc20).rate(); // {fiatTok/tok} * 1e27

        // {attoUSD/qTok} = {fiatTok/tok} * 1e27 * {attoUSD/fiatTok} / {qTok/tok}
        // result = rateInRAYs / 1e27 * 1e18 / 10**decimals();
        int128 shiftLeft = -9 - int8(decimals());

        // {attoUSD/qTok}
        return toFix(rateInRAYs, shiftLeft);
    }

    function fiatcoin() public view override returns (address) {
        return IStaticAToken(_erc20).ATOKEN().UNDERLYING_ASSET_ADDRESS();
    }

    function isFiatcoin() external pure override returns (bool) {
        return false;
    }
}
