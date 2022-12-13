// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/libraries/Fixed.sol";
import "./IUniswapV3Pool.sol";

/**
 * @title ArrakisVaultCollateral
 * @notice Collateral plugin for a FraxPair LP Tokens representing a share of 
 * a pool containing a pair of coins pegged to UOA (USD). This is like
 * ArrakisVaultCollateral, but more generalized so the tokens can also be non-fiat
 * Expected: {tok} != {ref}, {target} == {UoA}  
 */
contract ArrakisVaultCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    // bitmap of which tokens are fiat:
    // e.g if the bit representation of tokenisFiat is:
    // 00...001 -> token0 is pegged to UoA
    // 00...010 -> token1 is pegged to UoA
    // 00...011 -> both of them are pegged to UoA;
    uint256 public immutable tokenisFiat;
    address public immutable uniswapPool; // address of underlying token's uniswap pool

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    AggregatorV3Interface public immutable token0chainlinkFeed;
    AggregatorV3Interface public immutable token1chainlinkFeed;
    int8 public immutable token0Decimals;
    int8 public immutable token1Decimals;

    /// @param tokenisFiat_ bitmap of which tokens are pegged to UoA 
    /// @param token0chainlinkFeed_ Feed units: {UoA/token0}
    /// @param token1chainlinkFeed_ Feed units: {UoA/token1}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// between amm price and oracle price
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        uint256 tokenisFiat_,
        AggregatorV3Interface token0chainlinkFeed_,
        AggregatorV3Interface token1chainlinkFeed_,
        int8 token0Decimals_, 
        int8 token1Decimals_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_
    )
        Collateral(
            fallbackPrice_,
            token0chainlinkFeed_, // this is only here to make Asset.sol happy :\
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        require(
            address(token0chainlinkFeed_) != address(0),
            "missing token0 chainlink feed"
        );
        require(
            address(token1chainlinkFeed_) != address(0),
            "missing token1 chainlink feed"
        );
        require(
            token0Decimals_ != 0,
            "token0Decimals cannot be 0"
        );
        require(
            token1Decimals_ != 0,
            "token0Decimals cannot be 0"
        );
        require(tokenisFiat_ <= 3 && tokenisFiat_ > 0, "invalid tokenisFiat bitmap");

        defaultThreshold = defaultThreshold_;

        prevReferencePrice = refPerTok();

        // chainlink feeds
        token0chainlinkFeed = token0chainlinkFeed_;
        token1chainlinkFeed = token1chainlinkFeed_;
        token0Decimals = token0Decimals_;
        token1Decimals = token1Decimals_;

        // is fiat
        tokenisFiat = tokenisFiat_; 
        uniswapPool = IArrakisVault(address(erc20_)).pool();
    }

    // used to check which tokens are fiat 
    function isTokenFiat(uint256 indexFromRight) public view returns (bool) {
        uint256 bitAtIndex = tokenisFiat & (1 << indexFromRight);
        return bitAtIndex > 0;
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
                // p1 {UoA/token1}
                try token1chainlinkFeed.price_(oracleTimeout) returns (uint192 p1) {
                    if (p0 > 0 && p1 > 0) {
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
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }

    function _checkPriceDeviation(uint192 p0, uint192 p1) internal {
        uint192 peg = FIX_ONE;

        // If prices are below their default-threshold price, default eventually
        uint192 pegDelta = (peg * defaultThreshold) / peg;
        // TODO: which div method uses less gas?

        // checks peg for token0 to UoA
        if(isTokenFiat(0)){

            if (p0 < peg - pegDelta || p0 > peg + pegDelta) {
                markStatus(CollateralStatus.IFFY);
            }
        }

        // checks peg for token1 to UoA
        if(isTokenFiat(1)){
            if (p1 < peg -  pegDelta || p1 > peg + pegDelta) {
                markStatus(CollateralStatus.IFFY);
            }
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        // gets supply of token0 and token1
        (uint256 _reserve0, uint256 _reserve1) = IArrakisVault(address(erc20)).getUnderlyingBalances(); 
        // TODO: is this (^) gas efficient?

        uint192 rate = divuu(
            Math.sqrt(uint192(_reserve0).mulu(_reserve1)), 
            IArrakisVault(address(erc20)).totalSupply()
        );

        return rate;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function strictPrice() public view virtual override returns (uint192) {
        (uint256 _reserve0, uint256 _reserve1) = IArrakisVault(address(erc20)).getUnderlyingBalances();
        uint192 r0 = shiftl_toFix(_reserve0, -token0Decimals);
        uint192 r1 = shiftl_toFix(_reserve1, -token1Decimals);

        uint192 priceTotal = uint192(mulDiv256(
            token0chainlinkFeed.price(oracleTimeout),
            r0,
            FIX_ONE
        ) + mulDiv256(
            token1chainlinkFeed.price(oracleTimeout),
            r1,
            FIX_ONE
        ));

        return priceTotal.div(uint192(IArrakisVault(address(erc20)).totalSupply()) );

    }

}