// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/p0/assets/Asset.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title CollateralP0
 * @notice A vanilla asset such as a fiatcoin, to be extended by more complex assets such as cTokens.
 */
contract CollateralP0 is ICollateral, AssetP0 {
    using FixLib for Fix;
    using Oracle for Oracle.Info;

    // Default Status:
    // whenDefault == NEVER: no risk of default
    // whenDefault > block.timestamp: delayed default may occur as soon as block.timestamp.
    //                In this case, the asset may recover, reachiving whenDefault == NEVER.
    // whenDefault <= block.timestamp: default has already happened (permanently)
    uint256 internal constant NEVER = type(uint256).max;
    uint256 internal whenDefault;
    uint256 internal prevBlock;  // Last block when updateDefaultStatus() was called
    Fix internal prevRate;       // Last rate when updateDefaultStatus() was called

    // solhint-disable-next-list no-empty-blocks
    constructor(address erc20_, IMain main_) AssetP0(erc20_, main_, Oracle.Source.AAVE) {}

    /// Forces an update in any underlying Defi protocol
    function poke() public virtual override(IAsset, AssetP0) {
        updateDefaultStatus();
    }

    function updateDefaultStatus() internal {
        if (whenDefault <= block.timestamp || block.number <= prevBlock) {
            // Nothing will change if either we're already fully defaulted
            // or if we've already updated default status this block.
            return;
        }

        // If the redemption rate has fallen, default immediately
        Fix newRate = rateFiatcoin();
        if (newRate.gte(prevRate)) {
            whenDefault = block.timestamp;
        }

        // If the underlying fiatcoin price is below the default-threshold price, default eventually
        if (whenDefault > block.timestamp) {
            Fix fiatcoinPrice = fiatcoinPriceUSD().shiftLeft(int8(fiatcoinDecimals()));
            bool fiatcoinIsDefaulting = fiatcoinPrice.lte(_main.defaultingFiatcoinPrice());
            whenDefault = fiatcoinIsDefaulting ? Math.min(whenDefault, block.timestamp + _main.defaultDelay()) : NEVER;
        }

        // Cache any lesser updates
        prevRate = newRate;
        prevBlock = block.number;
    }

    // Returns this asset's default status
    function status() public view returns (AssetStatus) {
        if (whenDefault == 0) {
            return AssetStatus.SOUND;
        } else if (block.timestamp < whenDefault) {
            return AssetStatus.IFFY;
        } else {
            return AssetStatus.DEFAULTED;
        }
    }

    /// @return {qFiatTok/qTok} Conversion rate between token and its fiatcoin. Incomparable across assets.
    function rateFiatcoin() public view virtual override returns (Fix) {
        // {qFiatTok/qTok} = {qFiatTok/fiatTok} / {qTok/tok}
        return toFixWithShift(1, int8(fiatcoinDecimals()) - int8(decimals()));
    }

    /// @return {attoUSD/qTok} Without using oracles, returns the expected attoUSD value of one qTok.
    function rateUSD() public view virtual override returns (Fix) {
        // {attoUSD/qTok} = {attoUSD/tok} / {qTok/tok}
        return toFixWithShift(1, 18 - int8(decimals()));
    }

    /// @return {attoUSD/qTok} The price in attoUSD of the asset's smallest unit
    function priceUSD() public view virtual override(IAsset, AssetP0) returns (Fix) {
        if (isFiatcoin()) {
            return _main.oracle().consult(Oracle.Source.AAVE, _erc20);
        } else {
            // {attoUSD/qTok} = {attoUSD/qFiatTok} * {qFiatTok/qTok}
            return fiatcoinPriceUSD().mul(rateFiatcoin());
        }
    }

    /// @return The number of decimals in the nested fiatcoin contract (or for the erc20 itself if it is a fiatcoin)
    function fiatcoinDecimals() public view override returns (uint8) {
        return IERC20Metadata(address(fiatcoin())).decimals();
    }

    /// @return The fiatcoin underlying the ERC20, or the erc20 itself if it is a fiatcoin
    function fiatcoin() public view virtual override returns (IERC20) {
        return IERC20(_erc20);
    }

    /// @return {attoUSD/qFiatTok} The price in attoUSD of the fiatcoin's smallest unit
    function fiatcoinPriceUSD()
        public
        view
        virtual
        override
        returns (Fix)
    {
        return _main.oracle().consult(Oracle.Source.AAVE, address(fiatcoin()));
    }

    /// @return Whether `_erc20` is a fiatcoin
    function isFiatcoin() public pure virtual override returns (bool) {
        return true;
    }

    /// @return Whether `_erc20` is an AToken (StaticAToken, actually)
    function isAToken() public pure virtual override(IAsset, AssetP0) returns (bool) {
        return false;
    }

    function isCollateral() public pure override(IAsset, AssetP0) returns (bool) { return true; }
}
