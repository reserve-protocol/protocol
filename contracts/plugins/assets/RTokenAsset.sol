// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/Asset.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IRToken.sol";
import "./RTokenPricingLib.sol";

contract RTokenAsset is Asset {
    // solhint-disable no-empty-blocks
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    constructor(
        IRToken rToken_,
        uint192 fallbackPrice_,
        uint192 maxTradeVolume_
    )
        Asset(
            fallbackPrice_,
            AggregatorV3Interface(address(1)),
            IERC20Metadata(address(rToken_)),
            IERC20Metadata(address(0)),
            maxTradeVolume_,
            1
        )
    {}

    /// @return p {UoA/rTok} The protocol's best guess of the redemption price of an RToken
    function price() public view override returns (uint192 p) {
        return RTokenPricingLib.price(IRToken(address(erc20)));
    }
}
