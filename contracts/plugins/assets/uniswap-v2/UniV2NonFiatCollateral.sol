// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2ERC20.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

import "./UniV2Asset.sol";
import "../OracleLib.sol";
import "../../../libraries/Fixed.sol";
import "./libraries/UniV2Math.sol";

/**
 * @title  UniswapV2Collateral
 * {tok} = UNI-V2 LP token
 * {ref} = UNIV2-SQRT-TA-TB ie sqrt(tokA*tokB) synthetic reference
 * {target} = UNIV2-SQRT-TA-TB
 * {UoA} = {target}= USD
 * @dev structure is different from Collateral abstract contract
 * so we directly import interfaces instead of Collateral parent.
 * Nevertheless helper functions for status are maintained
 * @dev check README file for details
 */
contract UniV2NonFiatCollateral is ICollateral, UniV2Asset {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // Default Status:
    // _whenDefault == NEVER: no risk of default (initial value)
    // _whenDefault > block.timestamp: delayed default may occur as soon as block.timestamp.
    //                In this case, the asset may recover, reachiving _whenDefault == NEVER.
    // _whenDefault <= block.timestamp: default has already happened (permanently)
    uint256 private constant NEVER = type(uint256).max;
    uint256 private _whenDefault = NEVER;

    bytes32 public immutable targetName;

    // prices
    uint192 public prevReferencePrice; // previous rate, {collateral/reference}
    uint192 public immutable defaultThreshold;

    /// constructor
    /// @param pairV2_ UniswapV2 pair address
    /// @param fallbackPrice_ fallback price for LP tokens
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA = USD
    /// @param delayUntilDefault_ delay until default from IFFY status
    /// @param targetName_ target name
    /// @param chainlinkFeedA_ Feed units: {UoA/tokA}
    /// @param chainlinkFeedB_ Feed units: {UoA/tokB}
    /// @param defaultThreshold_ threshold for pool ratio
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    constructor(
        address pairV2_,
        uint192 fallbackPrice_,
        uint192 maxTradeVolume_,
        uint256 delayUntilDefault_,
        AggregatorV3Interface chainlinkFeedA_,
        AggregatorV3Interface chainlinkFeedB_,
        bytes32 targetName_,
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
        require(defaultThreshold_ > 0, "[UNIV2COL DEPLOY ERROR]: defaultThreshold zero");
        targetName = targetName_;
        defaultThreshold = defaultThreshold_;
        prevReferencePrice = refPerTok();
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

    /// @dev refPerTok = sqrt(xy)/L
    /// constant when liq added or removed, increases on trades due to fees.
    /// @dev see README for details
    function refPerTok() public view override returns (uint192) {
        // get x and y
        (uint112 x, uint112 y, ) = pairV2.getReserves();
        uint256 liq = pairV2.totalSupply();
        uint192 xs = uint192(x * 10**(18 - decA));
        uint192 ys = uint192(y * 10**(18 - decB));
        // rpt 18 decimals
        uint192 rpt = (UniV2Math.sqrt(xs.mulu(ys)) * 10**18).divu(liq);
        return rpt;
    }

    /// targetPerRef {target/ref} = 1
    /// @dev see README for details
    function targetPerRef() public pure override returns (uint192) {
        return FIX_ONE;
    }

    /// @return {UoA/target} The price of a target unit in UoA
    /// @dev can return 0 an revert
    function pricePerTarget() public view returns (uint192) {
        uint192 pA = 0;
        uint192 pB = 0;
        pA = chainlinkFeedA.price(oracleTimeout);
        pB = chainlinkFeedB.price(oracleTimeout);
        (uint112 x, uint112 y, ) = pairV2.getReserves();
        // reserves to 18 decimals
        uint192 reserveA = uint192(x * 10**(18 - decA));
        uint192 reserveB = uint192(y * 10**(18 - decB));
        uint192 sqrt = UniV2Math.sqrt(reserveA * reserveB);
        return (reserveA.mulu(pA) + reserveB.mulu(pB)).divu(sqrt, ROUND);
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
            try chainlinkFeedA.price_(oracleTimeout) returns (uint192 pA) {
                try chainlinkFeedB.price_(oracleTimeout) returns (uint192 pB) {
                    //check soft default ratio away from prices
                    (uint112 x, uint112 y, ) = pairV2.getReserves();
                    uint192 ratio = uint192((y * 10**(18 - decB))).div(
                        uint192(x * 10**(18 - decA))
                    );
                    uint192 deltaR = (pA.div(pB).mul(defaultThreshold));
                    if (ratio < pA.div(pB) - deltaR || ratio > pA.div(pB) + deltaR)
                        markStatus(CollateralStatus.IFFY);
                    else markStatus(CollateralStatus.SOUND);
                } catch (bytes memory errData) {
                    if (errData.length == 0) revert(); // solhint-disable-line reason-string
                    markStatus(CollateralStatus.IFFY);
                }
            } catch (bytes memory errData) {
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        }

        // update prev price
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }

        // No interactions beyond the initial refresher
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// Not aplicable for UniV2
    /// @dev delegatecall
    function claimRewards() external override(IRewardable, UniV2Asset) {
        emit RewardsClaimed(erc20, pairV2.balanceOf(address(this)));
    }

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
