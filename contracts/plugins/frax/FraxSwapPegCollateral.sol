// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/libraries/Fixed.sol";
import "./IFraxSwapPair.sol";

/**
 * @title FraxSwapPegCollateral
 * @notice Collateral plugin for a FraxPair LP Token representing a share of 
 * a pool containing a pair of coins pegged to UOA (USD), 
 * Expected: {tok} != {ref}, {target} == {UoA}  
 */
contract FraxSwapPegCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    int8 public immutable referenceERC20Decimals;

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    AggregatorV3Interface public immutable token0chainlinkFeed;
    AggregatorV3Interface public immutable token1chainlinkFeed;

    /// @param token0chainlinkFeed_ Feed units: {UoA/token0}
    /// @param token1chainlinkFeed_ Feed units: {UoA/token1}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface token0chainlinkFeed_,
        AggregatorV3Interface token1chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        int8 referenceERC20Decimals_
    )
        Collateral(
            fallbackPrice_,
            AggregatorV3Interface(address(0)),
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        require(referenceERC20Decimals_ > 0, "referenceERC20Decimals missing");
        defaultThreshold = defaultThreshold_;
        referenceERC20Decimals = referenceERC20Decimals_;

        prevReferencePrice = refPerTok();

        // chainlink feeds
        token0chainlinkFeed = token0chainlinkFeed_;
        token1chainlinkFeed = token1chainlinkFeed_;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function strictPrice() public view virtual override returns (uint192) {
        (uint192 _reserve0, uint192 _reserve1,) = IFraxswapPair(address(erc20)).getReserves();

        uint192 priceTotal = token0chainlinkFeed.price(oracleTimeout).mul(_reserve0) + 
            token1chainlinkFeed.price(oracleTimeout).mul(_reserve1);

        return priceTotal.div( uint192(IFraxswapPair(address(erc20)).totalSupply()) );

    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
                // p0 {UoA/token0}
            try token0chainlinkFeed.price_(oracleTimeout) returns (uint192 p0) {
                // We don't need the return value from this next feed, but it should still function
                // p1 {UoA/token1}
                try token1chainlinkFeed.price_(oracleTimeout) returns (uint192 p1) {
                    if (p0 > 0 || p1 > 0) {
                        _checkPriceDeviation(p0, p1);
                    } else {
                        markStatus(CollateralStatus.IFFY);
                    }
                } catch (bytes memory errData) {
                    // see: docs/solidity-style.md#Catching-Empty-Data
                    if (errData.length == 0) revert(); // solhint-disable-line reason-string
                    markStatus(CollateralStatus.IFFY);
                }
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }

        // No interactions beyond the initial refresher
    }

    function _checkPriceDeviation(uint192 p0, uint192 p1) internal {
        // {target/ref}
        uint192 peg = 1 ether; // 1 ether = 1e18 
        // D18{target/ref}= D18{target/ref} * D18{1} / D18

        address token0 = IFraxswapPair(address(erc20)).token0();
        // exchange rate between tokens in the fraxswap amm p0:p1
        uint192 p = uint192(IFraxswapPair(address(erc20)).getAmountOut(
            peg, 
            token0
        ));

        uint192 delta = (peg * defaultThreshold) / peg;

        // If the price is below the default-threshold price, default eventually
        if (p0 < peg - delta || p0 > peg + delta) {
            markStatus(CollateralStatus.IFFY);
        } else if (p1 < peg - delta || p1 > peg + delta) {
            markStatus(CollateralStatus.IFFY);
        // default if the internal exchange rate between the tokens
        // in the AMM is very different from the value from the oracles
        // TODO: is this necessary?
        } else if (p < peg - delta || p > peg + delta) {
            markStatus(CollateralStatus.IFFY);
        } else {
            markStatus(CollateralStatus.SOUND);
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        // gets supply of token0 and token1
        (uint256 _reserve0, uint256 _reserve1,) = IFraxswapPair(address(erc20)).getReserves();

        // rate is sqrt(x * y)/L
        uint192 rate = uint192(Math.sqrt((_reserve0) * (_reserve1))).div(
                        uint192(IFraxswapPair(address(erc20)).totalSupply()));

        return rate;
    }
}
