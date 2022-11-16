// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";

interface IConvexStakingWrapper {
    function getConvexPoolId() external view returns (address);
}

interface ICurveUSDMemPool {
    function get_virtual_price() external view returns (uint256);
}

/**
 * @title ATokenFiatCollateral
 * @notice Collateral plugin for an Curve LP Token for a UoA-pegged asset,
 * like LUSD+3Crv or a PUSD+#Crv
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract CurveStableCoinLPCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    int8 public immutable referenceERC20Decimals;
    uint192 public immutable defaultThreshold; // {%} e.g. 0.05
    address public immutable curveStablePool;
    uint192 public prevReferencePrice; // previous rate, {collateral/reference}
    address public immutable convexWrappingContract;
    AggregatorV3Interface[] public stableCoinChainLinkFeeds;
    uint192[] public stableCoinThresholds;

    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param delayUntilDefault_ {s} The number of seconds an oracle can mulfunction
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        IERC20Metadata rewardERC20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint256 delayUntilDefault_,
        uint192 defaultThreshold_,
        address curveStablePool_,
        int8 referenceERC20Decimals_,
        address convexWrappingContract_
    )
        Collateral(
            fallbackPrice_,
            chainlinkFeed_,
            erc20_,
            rewardERC20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(targetName_ != bytes32(0), "targetName missing");
        require(delayUntilDefault_ > 0, "delayUntilDefault zero");
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        defaultThreshold = defaultThreshold_;
        referenceERC20Decimals = referenceERC20Decimals_;
        curveStablePool = curveStablePool_;
        prevReferencePrice = refPerTok();
        convexWrappingContract = convexWrappingContract_;
    }

    /// Setting the chainlink pricefeeds for stable coins backing the LP token
    function setChainlinkPriceFeedsForStableCoins(
        AggregatorV3Interface[] memory stableCoinChainLinkFeeds_,
        uint192[] memory stableCoinThresholds_
    ) external {
        stableCoinChainLinkFeeds = stableCoinChainLinkFeeds_;
        stableCoinThresholds = stableCoinThresholds_;
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
            uint192 stableCoinValueSum = 0;
            for (uint256 i = 0; i < stableCoinChainLinkFeeds.length; i++) {
                try stableCoinChainLinkFeeds[i].price_(oracleTimeout) returns (uint192 p) {
                    // Check for soft default of underlying reference token
                    // D18{UoA/ref} = D18{UoA/target} * D18{target/ref} / D18
                    uint192 peg = targetPerRef() / FIX_ONE;
                    stableCoinValueSum = stableCoinValueSum + peg;

                    // D18{UoA/ref}= D18{UoA/ref} * D18{1} / D18
                    uint192 delta = (peg * stableCoinThresholds[i]) / FIX_ONE; // D18{UoA/ref}

                    // If the price is below the default-threshold price, default eventually
                    // uint192(+/-) is the same as Fix.plus/minus
                    if (p < peg - delta || p > peg + delta) markStatus(CollateralStatus.IFFY);
                    else markStatus(CollateralStatus.SOUND);
                } catch (bytes memory errData) {
                    // see: docs/solidity-style.md#Catching-Empty-Data
                    if (errData.length == 0) revert(); // solhint-disable-line reason-string
                    markStatus(CollateralStatus.IFFY);
                }
            }
            checkAverageValueDeviation(stableCoinValueSum);
        }

        prevReferencePrice = referencePrice;
        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }

        // No interactions beyond the initial refresher
    }

    function checkAverageValueDeviation(uint192 stableCoinValueSum) internal {
        uint192 avgStableCoinsPrice = stableCoinValueSum.divu(stableCoinChainLinkFeeds.length);
        uint192 stableCoinAvgDelta = (avgStableCoinsPrice * defaultThreshold) / FIX_ONE;
        if (
            avgStableCoinsPrice < avgStableCoinsPrice - stableCoinAvgDelta ||
            avgStableCoinsPrice > avgStableCoinsPrice + stableCoinAvgDelta
        ) markStatus(CollateralStatus.IFFY);
        else markStatus(CollateralStatus.SOUND);
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    /// Curve calculate it and provides the ratio as the value of the collateral token
    function refPerTok() public view override returns (uint192) {
        uint256 refPerTokValue = ICurveUSDMemPool(curveStablePool).get_virtual_price();
        int8 shiftLeft = 8 - referenceERC20Decimals - 18;
        return shiftl_toFix(refPerTokValue, shiftLeft);
    }

    /// Get the message needed to call in order to claim rewards for holding this asset.
    /// @return _to The address to send the call to
    /// @return _cd The calldata to send
    function getClaimCalldata() external view override returns (address _to, bytes memory _cd) {
        _to = convexWrappingContract;
        _cd = abi.encodeWithSignature("getReward(address)", msg.sender);
    }
}
