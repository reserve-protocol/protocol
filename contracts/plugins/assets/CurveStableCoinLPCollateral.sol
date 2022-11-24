// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";

interface IConvexStakingWrapper {
    function getConvexPoolId() external view returns (address);
}

interface Curve {
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

    struct Configuration {
        uint192 fallbackPrice_;
        AggregatorV3Interface chainlinkFeed_;
        IERC20Metadata erc20_;
        IERC20Metadata rewardERC20_;
        uint192 maxTradeVolume_;
        uint48 oracleTimeout_;
        bytes32 targetName_;
        uint256 delayUntilDefault_;
        uint192 defaultThreshold_;
        address curveStablePool_;
        int8 referenceERC20Decimals_;
        address convexWrappingContract_;
        AggregatorV3Interface[] stableCoinChainLinkFeeds_;
        uint192[] stableCoinThresholds_;
    }

    int8 public immutable referenceERC20Decimals;
    uint192 public immutable defaultThreshold; // {%} e.g. 0.05
    address public immutable curveStablePool;
    uint192 public prevReferencePrice; // previous rate, {collateral/reference}
    address public immutable convexWrappingContract;
    AggregatorV3Interface[] public stableCoinChainLinkFeeds;
    uint192[] public stableCoinThresholds;

    constructor(Configuration memory config)
        Collateral(
            config.fallbackPrice_,
            config.chainlinkFeed_,
            config.erc20_,
            config.rewardERC20_,
            config.maxTradeVolume_,
            config.oracleTimeout_,
            config.targetName_,
            config.delayUntilDefault_
        )
    {
        require(config.targetName_ != bytes32(0), "targetName missing");
        require(config.delayUntilDefault_ > 0, "delayUntilDefault zero");
        require(config.defaultThreshold_ > 0, "defaultThreshold zero");
        defaultThreshold = config.defaultThreshold_;
        referenceERC20Decimals = config.referenceERC20Decimals_;
        curveStablePool = config.curveStablePool_;
        prevReferencePrice = refPerTok();
        convexWrappingContract = config.convexWrappingContract_;
        stableCoinChainLinkFeeds = config.stableCoinChainLinkFeeds_;
        stableCoinThresholds = config.stableCoinThresholds_;
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
            for (uint256 i = 0; i < stableCoinChainLinkFeeds.length; i++) {
                try stableCoinChainLinkFeeds[i].price_(oracleTimeout) returns (uint192 p) {
                    // Check for soft default of underlying reference token
                    // D18{UoA/ref} = D18{UoA/target} * D18{target/ref} / D18
                    uint192 peg = targetPerRef();

                    // D18{UoA/ref}= D18{UoA/ref} * D18{1} / D18
                    uint192 delta = (peg * stableCoinThresholds[i]) / FIX_ONE;

                    // If the price is below the default-threshold price, default eventually
                    // uint192(+/-) is the same as Fix.plus/minus
                    if (p < peg - delta || p > peg + delta) {
                        markStatus(CollateralStatus.IFFY);
                        break;
                    } else markStatus(CollateralStatus.SOUND);
                } catch (bytes memory errData) {
                    // see: docs/solidity-style.md#Catching-Empty-Data
                    if (errData.length == 0) revert(); // solhint-disable-line reason-string
                    markStatus(CollateralStatus.IFFY);
                    break;
                }
            }
        }

        prevReferencePrice = referencePrice;
        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    /// Curve calculate it and provides the ratio as the value of the collateral token
    function refPerTok() public view override returns (uint192) {
        uint256 refPerTokValue = Curve(curveStablePool).get_virtual_price();
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
