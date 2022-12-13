// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../libraries/Fixed.sol";
import "../assets/RevenueHidingCollateral.sol";
import "./IVaultToken.sol";
import "./IPriceProvider.sol";

contract RHVaultTokenGenericCollateral is RevenueHidingCollateral {
    using FixLib for uint192;

    IPriceProvider public immutable priceProvider;
    IERC20Metadata public immutable underlyingToken;

    constructor(
        address vault_,
        uint256 maxTradeVolume_,
        uint256 fallbackPrice_,
        bytes32 targetName_,
        uint256 delayUntilDefault_,
        uint16 basisPoints_,
        IPriceProvider priceProvider_,
        IERC20Metadata underlyingToken_
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
        require(address(priceProvider_) != address(0), "priceProvider_ is required");
        require(address(underlyingToken_) != address(0), "underlyingToken_ is required");
        priceProvider = priceProvider_;
        underlyingToken = underlyingToken_;
    }

    // solhint-disable-next-line no-empty-blocks
    function claimRewards() external override {}

    /// @return {ref/tok} Quantity of whole reference units (actual) per whole collateral tokens
    function actualRefPerTok() public view override returns (uint192) {
        IVaultToken vault = IVaultToken(address(erc20));
        uint256 pps = vault.pricePerShare();
        return shiftl_toFix(pps, -int8(vault.decimals()));
    }

    /// Can return 0, can revert
    /// @return {UoA/tok} The current price()
    function strictPrice() public view override returns (uint192) {
        uint256 _price = priceProvider.price(address(underlyingToken));
        if (_price == 0) {
            revert PriceOutsideRange();
        }
        return shiftl_toFix(_price, -int8(priceProvider.decimals())).mul(actualRefPerTok());
    }

    function _checkAndUpdateDefaultStatus() internal pure override returns (bool isSound) {
        isSound = true;
    }
}
