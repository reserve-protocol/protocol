// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/euler/IEulerCollateral.sol";

/**
 * 
 * @title ewstETH Collateral
 * collateral token: ewstETH = Euler Pool Wrapped liquid staked Ether
 * reference: stETH = liquid staked Ether
 * target: ETH
 * 
 */

contract ETokenWSTETHCollateral is Collateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    uint192 public prevReferencePrice; 
    uint192 public immutable defaultThreshold;

    AggregatorV3Interface public immutable targetUnitUSDChainlinkFeed;
    IWSTETH public immutable wsteth;

    /// @param refUnitChainlinkFeed_ {ref} STETH/USD
    /// @param targetUnitUSDChainlinkFeed_, {target} ETH/USD
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface refUnitChainlinkFeed_,
        AggregatorV3Interface targetUnitUSDChainlinkFeed_, 
        IERC20Metadata erc20_, 
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IWSTETH wsteth_
    )
        Collateral(
            fallbackPrice_,
            refUnitChainlinkFeed_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        require(address(targetUnitUSDChainlinkFeed_) != address(0), 
        "targetUnitUSDChainlinkFeed missing");
        require(address(wsteth_) != address(0), "wstETH missing");

        defaultThreshold = defaultThreshold_;
        targetUnitUSDChainlinkFeed = targetUnitUSDChainlinkFeed_;
        wsteth = wsteth_;

        prevReferencePrice = refPerTok();
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function strictPrice() public view virtual override returns (uint192) {
        // ewstETH Price = USD/stETH * stETH/wstETH *  wstETH/ewstETH
        return chainlinkFeed.price(oracleTimeout)
        .mul(getStETHPerWstETH())
        .mul(refPerTok())
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
            // reference price {UoA/ref}
            try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
                // target price {UoA/target}
                try targetUnitUSDChainlinkFeed.price_(oracleTimeout) returns (uint192 t) {

                    // peg == ETH Price * 1e18 / stETH Price
                    uint192 peg = t.mul(FIX_ONE).div(p);
                    uint192 delta = defaultThreshold;

                    // soft-defaults if the {target/underlying} rate deviates more than threashold %
                    // e.g if delta == 5%, and 0.94 < 0.95 || 1.06 > 1.05 -> default
                    if ( peg < FIX_ONE - delta || peg > FIX_ONE + delta)
                    markStatus(CollateralStatus.IFFY);
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
    // = stETH/wstETH * wstETH/ewstETH
    function refPerTok() public view override returns (uint192) {
        uint256 wstethAmt = IEToken(address(erc20)).convertBalanceToUnderlying(FIX_ONE_256);
        uint256 stethAmt = IWSTETH(address(wsteth)).getStETHByWstETH(wstethAmt);
        return shiftl_toFix(stethAmt, -18);
    }
    
    // stETH/wstETH
    function getStETHPerWstETH() internal view returns (uint192) {
        return _safeWrap(wsteth.stEthPerToken());
    }

    // testing purpose1:  stETH/USD Price
    function getStETHPrice() public view returns (uint192) {
       return chainlinkFeed.price(oracleTimeout);
    }

    // testing purpose2:  ETH/USD Price
    function getETHPrice() public view returns (uint192) {
       return targetUnitUSDChainlinkFeed.price(oracleTimeout);
    }

    // testing purpose3: ETH/stETH
    // Check how much stETH depegs now 
    function getTargetPerRef() public view returns (uint192) {
        return targetUnitUSDChainlinkFeed.price(oracleTimeout)
        .mul(FIX_ONE)
        .div(chainlinkFeed.price(oracleTimeout));
    }

    // testing purpose4: USD/wstETH 
    // = USD/stETH * stETH/wstETH
    function getWstETHPrice() public view returns (uint192) {
       return chainlinkFeed.price(oracleTimeout).mul(getStETHPerWstETH()).div(FIX_ONE);
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev delegatecall
    function claimRewards() external virtual override {
        emit RewardsClaimed(IERC20(address(0)), 0);
    }
}

