// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "../../libraries/Fixed.sol";
import "../assets/RevenueHidingCollateral.sol";
import "./IYToken.sol";
import "./IPriceProvider.sol";

contract YTokenGenericCollateral is RevenueHidingCollateral {
    using FixLib for uint192;
    IPriceProvider public immutable priceProvider;

    constructor(
        address vault_,
        uint256 maxTradeVolume_,
        uint256 fallbackPrice_,
        bytes32 targetName_,
        uint256 delayUntilDefault_,
        uint16 basisPoints_,
        IPriceProvider priceProvider_
    )
        RevenueHidingCollateral(
            vault_,
            maxTradeVolume_,
            fallbackPrice_,
            targetName_,
            delayUntilDefault_,
            basisPoints_
        )
    {
        priceProvider = priceProvider_;
    }

    // solhint-disable-next-line no-empty-blocks
    function claimRewards() external override {}

    function actualRefPerTok() public view override returns (uint192) {
        IYToken vault = IYToken(address(erc20));
        uint256 pps = vault.pricePerShare();
        return shiftl_toFix(pps, -int8(vault.decimals()));
    }

    function strictPrice() public view override returns (uint192) {
        IYToken vault = IYToken(address(erc20));
        return
            shiftl_toFix(
                priceProvider.price(address(vault.token())),
                -int8(priceProvider.decimals())
            ).mul(refPerTok());
    }

    // solhint-disable-next-line no-empty-blocks
    function _checkAndUpdateDefaultStatus() internal override returns (bool isSound) {}
}
