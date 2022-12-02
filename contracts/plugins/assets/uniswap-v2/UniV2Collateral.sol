// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "./UniV2Asset.sol";
import "../OracleLib.sol";
import "../../../libraries/Fixed.sol";
import "./libraries/UniV2Math.sol";

/**
 * @title  UniswapV2Collateral
 * {tok} = UNI-V2 LP token
 * {ref} = UNIV2-SQRT-TA-TB ie sqrt(tokA*tokB) synthetic reference
 * {target} = USD
 * {UoA} = {target}= USD
 * @dev structure is different from Collateral abstract contract
 * so we directly import interfaces instead of Collateral parent.
 * Nevertheless helper functions for status are maintained
 * @dev check README file for details
 */
contract UniV2Collateral is ICollateral, UniV2Asset {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // Default Status:
    // _whenDefault == NEVER: no risk of default (initial value)
    // _whenDefault > block.timestamp: delayed default may occur as soon as block.timestamp.
    //                In this case, the asset may recover, reachiving _whenDefault == NEVER.
    // _whenDefault <= block.timestamp: default has already happened (permanently)
    uint256 private constant NEVER = type(uint256).max;
    uint256 private _whenDefault = NEVER;

    bytes32 public immutable targetName = "USD";
    // USD is "0x5553440000000000000000000000000000000000000000000000000000000000"

    // prices
    uint192 public prevReferencePrice; // previous rate, {collateral/reference}
    uint192 public immutable pegA;
    uint192 public immutable pegB;
    uint192 public immutable defaultThresholdA;
    uint192 public immutable defaultThresholdB;
    uint192 public immutable defaultThreshold;

    /// constructor
    /// @param pairV2_ UniswapV2 pair address
    /// @param fallbackPrice_ fallback price for LP tokens
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA = USD
    /// @param delayUntilDefault_ delay until default from IFFY status
    /// @param pegA_ pegged price for tokenA
    /// @param pegB_ pegged price for tokenB
    /// @param chainlinkFeedA_ Feed units: {UoA/tokA}
    /// @param chainlinkFeedB_ Feed units: {UoA/tokB}
    /// @param defaultThresholdA_ threshold for tokenA
    /// @param defaultThresholdB_ threshold for tokenB
    /// @param defaultThreshold_ threshold for pool ratio
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    constructor(
        address pairV2_,
        uint192 fallbackPrice_,
        uint192 maxTradeVolume_,
        uint256 delayUntilDefault_,
        AggregatorV3Interface chainlinkFeedA_,
        AggregatorV3Interface chainlinkFeedB_,
        uint192 pegA_,
        uint192 pegB_,
        uint192 defaultThresholdA_,
        uint192 defaultThresholdB_,
        uint192 defaultThreshold_,
        uint48 oracleTimeout_
    )
        UniV2Asset(
            pairV2_,
            fallbackPrice_,
            maxTradeVolume_,
            delayUntilDefault_,
            chainlinkFeedA_,
            chainlinkFeedB_,
            oracleTimeout_
        )
    {
        pegA = pegA_;
        pegB = pegB_;
        defaultThresholdA = defaultThresholdA_;
        defaultThresholdB = defaultThresholdB_;
        defaultThreshold = defaultThreshold_;
        uint L = pairV2.totalSupply();
        (uint112 x, uint112 y, ) = pairV2.getReserves();
        prevReferencePrice = uint192(UniV2Math.sqrt(x * y) / L);
    }

    /// @return The collateral's status
    function status() public view virtual override returns (CollateralStatus) {
        if (_whenDefault == NEVER) {
            return CollateralStatus.SOUND;
        } else if (_whenDefault > block.timestamp) {
            return CollateralStatus.IFFY;
        } else {
            return CollateralStatus.DISABLED;
        }
    }

    /// @dev refPerTok = sqrt(xy)/L (cte when liq added or removed, increases on trades due to fees.)
    /// @dev see README for details
    function refPerTok() public view override returns (uint192) {
        // get x and y
        (uint112 x, uint112 y, ) = pairV2.getReserves();
        uint L = pairV2.totalSupply();
        uint192 rate = uint192(UniV2Math.sqrt(x * y) / L);
        // TODO check units range
        return rate;
    }

    /// targetPerRef {target/ref} = USD/sqrt(xy) = 2 sqrt(pegA*pegB)
    /// @dev see README for details
    function targetPerRef() public view override returns (uint192) {
        return 2 * uint192(UniV2Math.sqrt(pegA * pegB));
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure override(IAsset, UniV2Asset) returns (bool) {
        return true;
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external override {
        // == Refresh ==
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            // tokenA soft default
            try chainlinkFeedA.price_(oracleTimeout) returns (uint192 p) {
                uint192 deltaA = (pegA * defaultThresholdA) / FIX_ONE;
                if (p < pegA - deltaA || p > pegA + deltaA) markStatus(CollateralStatus.IFFY);
                else markStatus(CollateralStatus.SOUND);
            } catch (bytes memory errData) {
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }

            // tokenB soft default
            try chainlinkFeedB.price_(oracleTimeout) returns (uint192 p) {
                uint192 deltaB = (pegB * defaultThresholdB) / FIX_ONE;
                if (p < pegB - deltaB || p > pegB + deltaB) markStatus(CollateralStatus.IFFY);
                else markStatus(CollateralStatus.SOUND);
            } catch (bytes memory errData) {
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }

            // check liquidity pool ratio
            (uint112 x, uint112 y, ) = pairV2.getReserves();
            uint192 ratio = y / x;
            uint192 deltaR = ((pegA / pegB) * defaultThreshold) / FIX_ONE;
            if (ratio < pegA / pegB - deltaR || ratio > pegA / pegB + deltaR)
                markStatus(CollateralStatus.IFFY);
            else markStatus(CollateralStatus.SOUND);
        }

        // update prev price
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }

        // No interactions beyond the initial refresher
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev delegatecall
    function claimRewards() external override(IRewardable, UniV2Asset) {}

    // === Helpers ===

    function markStatus(CollateralStatus status_) internal {
        if (_whenDefault <= block.timestamp) return; // prevent DISABLED -> SOUND/IFFY

        if (status_ == CollateralStatus.SOUND) {
            _whenDefault = NEVER;
        } else if (status_ == CollateralStatus.IFFY) {
            _whenDefault = Math.min(block.timestamp + delayUntilDefault, _whenDefault);
        } else if (status_ == CollateralStatus.DISABLED) {
            _whenDefault = block.timestamp;
        }
    }

    function alreadyDefaulted() internal view returns (bool) {
        return _whenDefault <= block.timestamp;
    }

    function whenDefault() public view returns (uint256) {
        return _whenDefault;
    }

    // === End helpers ===
}
