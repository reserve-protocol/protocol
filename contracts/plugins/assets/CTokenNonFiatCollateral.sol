// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "contracts/libraries/Fixed.sol";

// ==== External Interfaces ====
// See: https://github.com/compound-finance/compound-protocol/blob/master/contracts/CToken.sol
interface ICToken {
    /// @dev From Compound Docs:
    /// The current (up to date) exchange rate, scaled by 10^(18 - 8 + Underlying Token Decimals).
    function exchangeRateCurrent() external returns (uint256);

    /// @dev From Compound Docs: The stored exchange rate, with 18 - 8 + UnderlyingAsset.Decimals.
    function exchangeRateStored() external view returns (uint256);
}

/**
 * @title CTokenNonFiatCollateral
 * @notice Collateral plugin for a cToken of a nonfiat collateral that requires default checks
 * For example:
 *   - cWBTC
 */
contract CTokenNonFiatCollateral is Collateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    /// Should not use Collateral.chainlinkFeed, since naming is ambiguous

    AggregatorV3Interface public immutable refUnitChainlinkFeed; // {target/ref}
    AggregatorV3Interface public immutable targetUnitChainlinkFeed; // {UoA/target}

    // Default Status:
    // whenDefault == NEVER: no risk of default (initial value)
    // whenDefault > block.timestamp: delayed default may occur as soon as block.timestamp.
    //                In this case, the asset may recover, reachiving whenDefault == NEVER.
    // whenDefault <= block.timestamp: default has already happened (permanently)
    uint256 internal constant NEVER = type(uint256).max;
    uint256 public whenDefault = NEVER;

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    uint256 public immutable delayUntilDefault; // {s} e.g 86400

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}
    address public immutable comptrollerAddr;

    int8 public immutable referenceERC20Decimals;

    /// @param refUnitChainlinkFeed_ Feed units: {target/ref}
    /// @param targetUnitUSDChainlinkFeed_ Feed units: {UoA/target}
    /// @param tradingRange_ {tok} The min and max of the trading range for this asset
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        AggregatorV3Interface refUnitChainlinkFeed_,
        AggregatorV3Interface targetUnitUSDChainlinkFeed_,
        IERC20Metadata erc20_,
        IERC20Metadata rewardERC20_,
        TradingRange memory tradingRange_,
        uint32 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        int8 referenceERC20Decimals_,
        address comptrollerAddr_
    )
        Collateral(
            AggregatorV3Interface(address(1)),
            erc20_,
            rewardERC20_,
            tradingRange_,
            oracleTimeout_,
            targetName_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        require(delayUntilDefault_ > 0, "delayUntilDefault zero");
        require(address(refUnitChainlinkFeed_) != address(0), "missing ref unit chainlink feed");
        require(
            address(targetUnitUSDChainlinkFeed_) != address(0),
            "missing target unit chainlink feed"
        );
        require(referenceERC20Decimals_ > 0, "referenceERC20Decimals missing");
        require(address(comptrollerAddr_) != address(0), "comptrollerAddr missing");
        defaultThreshold = defaultThreshold_;
        delayUntilDefault = delayUntilDefault_;
        targetUnitChainlinkFeed = targetUnitUSDChainlinkFeed_;
        refUnitChainlinkFeed = refUnitChainlinkFeed_;
        referenceERC20Decimals = referenceERC20Decimals_;
        prevReferencePrice = refPerTok();
        comptrollerAddr = comptrollerAddr_;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/target} * {target/ref} * {ref/tok}
        return
            targetUnitChainlinkFeed
                .price(oracleTimeout)
                .mul(refUnitChainlinkFeed.price(oracleTimeout))
                .mul(refPerTok());
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        // == Refresh ==
        // Update the Compound Protocol
        ICToken(address(erc20)).exchangeRateCurrent();

        if (whenDefault <= block.timestamp) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (referencePrice < prevReferencePrice) {
            whenDefault = block.timestamp;
        } else {
            // p {target/ref}
            try refUnitChainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
                // We don't need the return value from this next feed, but it should still function
                try targetUnitChainlinkFeed.price_(oracleTimeout) returns (uint192) {
                    priceable = true;

                    // {target/ref}
                    uint192 peg = targetPerRef();

                    // D18{target/ref}= D18{target/ref} * D18{1} / D18
                    uint192 delta = (peg * defaultThreshold) / FIX_ONE;

                    // If the price is below the default-threshold price, default eventually
                    // uint192(+/-) is the same as Fix.plus/minus
                    if (p < peg - delta || p > peg + delta) {
                        whenDefault = Math.min(block.timestamp + delayUntilDefault, whenDefault);
                    } else whenDefault = NEVER;
                } catch {
                    priceable = false;
                }
            } catch {
                priceable = false;
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }

        // No interactions beyond the initial refresher
    }

    /// @return The collateral's status
    function status() public view virtual override returns (CollateralStatus) {
        if (whenDefault == NEVER) {
            return priceable ? CollateralStatus.SOUND : CollateralStatus.UNPRICED;
        } else if (whenDefault > block.timestamp) {
            return priceable ? CollateralStatus.IFFY : CollateralStatus.UNPRICED;
        } else {
            return CollateralStatus.DISABLED;
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        uint256 rate = ICToken(address(erc20)).exchangeRateStored();
        int8 shiftLeft = 8 - referenceERC20Decimals - 18;
        return shiftl_toFix(rate, shiftLeft);
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return targetUnitChainlinkFeed.price(oracleTimeout);
    }

    /// Get the message needed to call in order to claim rewards for holding this asset.
    /// @return _to The address to send the call to
    /// @return _cd The calldata to send
    function getClaimCalldata()
        external
        view
        virtual
        override
        returns (address _to, bytes memory _cd)
    {
        _to = comptrollerAddr;
        _cd = abi.encodeWithSignature("claimComp(address)", msg.sender);
    }
}
