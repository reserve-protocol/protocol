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
    /// @return max {tok} The maximum trade size
    function _tradeSizes() internal view virtual override returns (uint192 min, uint192 max) {
        min = tradingRange.minAmt;
        max = tradingRange.maxAmt;
        try RTokenPricingLib.price(IRToken(address(erc20))) returns (uint192 p) {
            // It's correct for the RToken to have a zero price right after a full basket change
            if (p > 0) {
                // min
                // {tok} = {UoA} / {UoA/tok}
                uint256 min256 = (FIX_ONE_256 * tradingRange.minVal + p - 1) / p;
                if (type(uint192).max < min256) revert UIntOutOfBounds();
                if (min256 > min) min = uint192(min256);

                // max
                // {tok} = {UoA} / {UoA/tok}
                uint256 max256 = (FIX_ONE_256 * tradingRange.maxVal) / p;
                if (type(uint192).max < max256) revert UIntOutOfBounds();
                if (max256 > 0 && max256 < max) max = uint192(max256);
            }
        } catch {}
    }
}
