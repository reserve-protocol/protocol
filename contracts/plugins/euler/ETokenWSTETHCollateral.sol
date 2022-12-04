// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/euler/IEulerCollateral.sol";

/**
 * @title eWstETH Collateral
 * collateral: ewstETH: Euler Pool: Wrapped liquid staked Ether
 * reference: wstETH
 * target: ETH
 * underlying: stETH: make sure that stETH/ETH depeg value doesn't cause significant loss in value.
 */

contract ETokenWSTETHCollateral is Collateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    uint192 public prevReferencePrice; 
    uint192 public immutable defaultThreshold;
    int8 public immutable referenceERC20Decimals;

    AggregatorV3Interface public immutable targetChainlinkFeed;
    IWSTETH public immutable wsteth;

    /// @param stETHChainlinkFeed_ Feed units: {target/ref}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface stETHChainlinkFeed_, // USD/stETH
        AggregatorV3Interface targetChainlinkFeed_, // USD/ETH
        IERC20Metadata erc20_, 
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        int8 referenceERC20Decimals_,
        IWSTETH wsteth_
    )
        Collateral(
            fallbackPrice_,
            stETHChainlinkFeed_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        require(referenceERC20Decimals_ > 0, "referenceERC20Decimals missing");
        require(address(targetChainlinkFeed_) != address(0), "targetChainlinkFeed missing");
        require(address(wsteth_) != address(0), "wstETH missing");

        defaultThreshold = defaultThreshold_;
        referenceERC20Decimals = referenceERC20Decimals_;
        targetChainlinkFeed = targetChainlinkFeed_;
        wsteth = wsteth_;

        prevReferencePrice = refPerTok();
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function strictPrice() public view virtual override returns (uint192) {
        // ewstETH Price = ewstETH/wstETH * wstETH/stETH * stETH/USD 
        return getStETHPerWstETH()
        .mul(refPerTok())
        .mul(chainlinkFeed.price(oracleTimeout))
        .div(FIX_ONE);
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        // == Refresh ==
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            // p {target/ref}
            try chainlinkFeed.price_(oracleTimeout) returns (uint192 underlyingP) {
                // We don't need the return value from this next feed, but it should still function
                try targetChainlinkFeed.price_(oracleTimeout) returns (uint192 targetP) {

                    // peg == targetPerUnderlying == ETH/stETH
                    uint192 peg = underlyingP.mul(FIX_ONE).div(targetP);
                    uint192 delta = (FIX_ONE * defaultThreshold) / FIX_ONE;

                    // If the price of underlying token is below the default-threshold price, default eventually
                    // e.g 0.94 < 0.95 || 1.06 > 1.05 
                    if (peg < FIX_ONE - delta || peg > FIX_ONE + delta) markStatus(CollateralStatus.IFFY);
                    else markStatus(CollateralStatus.SOUND);
                } catch (bytes memory errData) {
                    // see: docs/solidity-style.md#Catching-Empty-Data
                    if (errData.length == 0) revert(); // solhint-disable-line reason-string
                    markStatus(CollateralStatus.IFFY);
                }
            } catch (bytes memory errData) {
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    // = ewstETH / wstETH
    function refPerTok() public view override returns (uint192) {
        uint256 rate = IEToken(address(erc20)).convertBalanceToUnderlying(FIX_ONE_256);
        int8 shiftLeft = referenceERC20Decimals * -1;
        return shiftl_toFix(rate, shiftLeft);
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    // = wstETH / ETH
    function targetPerRef() public view override returns (uint192) {
        return getWstETHPrice().mul(FIX_ONE).div(targetChainlinkFeed.price(oracleTimeout));
    }

    // stETH/ETH : Check how much stETH depegs now 
    function getTargetPerUnderlying() public view returns (uint192) {
        uint192 targetPerUnderlying = 
        chainlinkFeed.price(oracleTimeout)
        .mul(FIX_ONE)
        .div(targetChainlinkFeed.price(oracleTimeout));

        return targetPerUnderlying;
    }

    // wstETH/stETH
    function getStETHPerWstETH() internal view returns (uint192) {
        return _safeWrap(wsteth.stEthPerToken());
    }

    // wstETH/USD = wstETH/stETH * stETH/USD
    function getWstETHPrice() public view returns (uint192) {
       return getStETHPerWstETH().mul(chainlinkFeed.price(oracleTimeout)).div(FIX_ONE);
    }

    // testing purpose1:  stETH/USD 
    function getStETHPrice() public view returns (uint192) {
       return chainlinkFeed.price(oracleTimeout);
    }

    // testing purpose2:  ETH/USD
    function getETHPrice() public view returns (uint192) {
       return targetChainlinkFeed.price(oracleTimeout);
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev delegatecall
    function claimRewards() external virtual override {
        emit RewardsClaimed(IERC20(address(0)), 0);
    }
}

