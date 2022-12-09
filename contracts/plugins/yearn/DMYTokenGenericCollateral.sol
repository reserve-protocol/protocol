// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "contracts/plugins/assets/OracleLib.sol";
import "../../libraries/Fixed.sol";
import "../assets/DemurrageCollateral.sol";
import "./IYToken.sol";
import "./IPriceProvider.sol";

contract DMYTokenGenericCollateral is DemurrageCollateral {
    IPriceProvider public immutable priceProvider;

    constructor(
        address vault_,
        uint256 maxTradeVolume_,
        uint256 fallbackPrice_,
        bytes32 targetName_,
        uint256 delayUntilDefault_,
        uint256 ratePerPeriod_,
        IPriceProvider priceProvider_
    )
        DemurrageCollateral(
            vault_,
            maxTradeVolume_,
            fallbackPrice_,
            targetName_,
            delayUntilDefault_,
            ratePerPeriod_
        )
    {
        priceProvider = priceProvider_;
    }

    // solhint-disable-next-line no-empty-blocks
    function claimRewards() external override {}

    function uTokPerTok() internal view override returns (uint192) {
        IYToken vault = IYToken(address(erc20));
        uint256 pps = vault.pricePerShare();
        return shiftl_toFix(pps, -int8(vault.decimals()));
    }

    function pricePerUTok() internal view override returns (uint192) {
        IYToken vault = IYToken(address(erc20));
        uint256 _price = priceProvider.price(address(vault.token()));
        if (_price == 0) {
            revert PriceOutsideRange();
        }
        return shiftl_toFix(_price, -int8(priceProvider.decimals()));
    }

    function _checkAndUpdateDefaultStatus() internal pure override returns (bool isSound) {
        isSound = true;
    }
}
