// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/proto0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "./CollateralP0.sol";

// Interfaces to contracts from: https://git.io/JX7iJ
interface IStaticAToken is IERC20 {
    // @return RAY{fiatTok/tok}
    function rate() external view returns (uint256);

    // solhint-disable-next-line func-name-mixedcase
    function ATOKEN() external view returns (AToken);

    function claimRewardsToSelf(bool forceUpdate) external;
}

interface AToken {
    // solhint-disable-next-line func-name-mixedcase
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
}

/// @dev In Aave the number of decimals of the staticAToken is always 18, but the underlying rebasing
/// AToken will have the same number of decimals as its fiatcoin.
contract ATokenCollateralP0 is CollateralP0 {
    using FixLib for Fix;

    // solhint-disable-next-line no-empty-blocks
    constructor(address erc20_) CollateralP0(erc20_) {}

    /// Claims any rewards such as COMP/AAVE for the asset
    function claimRewards() external override {
        IStaticAToken(address(erc20())).claimRewardsToSelf(true);
    }

    /// @return {qFiatTok/qTok}
    function rateFiatcoin() public view override returns (Fix) {
        uint256 rateInRAYs = IStaticAToken(_erc20).rate(); // {ray fiatTok/tok}

        // Unit conversions:
        //   1{fiatTok} = 10**fiatcoinDecimals(){qFiatTok}
        //   1{tok} = 10**decimals(){qTok}
        //   1 = 1e27 {ray}

        // {qFiatTok/qTok} = {ray fiatTok/tok} / {ray} * {qFiatTok/fiatTok} / {qTok/tok}
        // result = rateInRAYs / 1e27 * 10**fiatcoinDecimals() / 10**decimals();

        int8 shiftLeft = -27 + int8(fiatcoinDecimals()) - int8(decimals());
        return toFixWithShift(rateInRAYs, shiftLeft);
    }

    // @return {attoUSD/qTok}
    function rateUSD() public view override returns (Fix) {
        uint256 rateInRAYs = IStaticAToken(_erc20).rate(); // {ray fiatTok/tok}

        // {attoUSD/qTok} = {ray fiatTok/tok} / {ray} * {attoUSD/fiatTok} / {qTok/tok}
        // result = rateInRAYs / 1e27 * 1e18 / 10**decimals();
        int8 shiftLeft = -9 - int8(decimals());

        // {attoUSD/qTok}
        return toFixWithShift(rateInRAYs, shiftLeft);
    }

    function fiatcoin() public view override returns (IERC20) {
        return IERC20(IStaticAToken(_erc20).ATOKEN().UNDERLYING_ASSET_ADDRESS());
    }

    function isFiatcoin() external pure override returns (bool) {
        return false;
    }
}
