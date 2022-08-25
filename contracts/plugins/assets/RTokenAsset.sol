// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/Asset.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IRToken.sol";
import "./RTokenPricingLib.sol";

contract RTokenAsset is Asset {
    // solhint-disable no-empty-blocks
    /// @param tradingRange_ {tok} The min and max of the trading range for this asset
    constructor(IRToken rToken_, TradingRange memory tradingRange_)
        Asset(
            AggregatorV3Interface(address(1)),
            IERC20Metadata(address(rToken_)),
            IERC20Metadata(address(0)),
            tradingRange_,
            1
        )
    {}

    /// @return p {UoA/rTok} The protocol's best guess of the redemption price of an RToken
    function price() public view override returns (uint192 p) {
        return RTokenPricingLib.price(IRToken(address(erc20)));
    }

    /// @return min {tok} The minimium trade size
    function minTradeSize() external view override returns (uint192 min) {
        try RTokenPricingLib.price(IRToken(address(erc20))) returns (uint192 p) {
            // It's correct for the RToken to have a zero price right after a full basket change
            if (p > 0) {
                // {tok} = {UoA} / {UoA/tok}
                // return tradingRange.minVal.div(p, CEIL);
                uint256 min256 = (FIX_ONE_256 * tradingRange.minVal + p - 1) / p;
                if (type(uint192).max < min256) revert UIntOutOfBounds();
                min = uint192(min256);
            }
        } catch {}
        if (min < tradingRange.minAmt) min = tradingRange.minAmt;
        if (min > tradingRange.maxAmt) min = tradingRange.maxAmt;
    }

    /// @return max {tok} The maximum trade size
    function maxTradeSize() external view override returns (uint192 max) {
        try RTokenPricingLib.price(IRToken(address(erc20))) returns (uint192 p) {
            // It's correct for the RToken to have a zero price right after a full basket change
            if (p > 0) {
                // {tok} = {UoA} / {UoA/tok}
                // return tradingRange.maxVal.div(p);
                uint256 max256 = (FIX_ONE_256 * tradingRange.maxVal) / p;
                if (type(uint192).max < max256) revert UIntOutOfBounds();
                max = uint192(max256);
            }
        } catch {}
        if (max == 0 || max > tradingRange.maxAmt) max = tradingRange.maxAmt;
        if (max < tradingRange.minAmt) max = tradingRange.minAmt;
    }

    // solhint-enable no-empty-blocks
}
