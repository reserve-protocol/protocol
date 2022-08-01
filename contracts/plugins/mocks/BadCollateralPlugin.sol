// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/ATokenFiatCollateral.sol";

contract BadCollateralPlugin is ATokenFiatCollateral {
    using OracleLib for AggregatorV3Interface;

    bool public checkSoftDefault = true; // peg
    bool public checkHardDefault = true; // defi invariant

    /// @param tradingRange_ {tok} The min and max of the trading range for this asset
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        IERC20Metadata rewardERC20_,
        TradingRange memory tradingRange_,
        uint32 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_
    )
        ATokenFiatCollateral(
            chainlinkFeed_,
            erc20_,
            rewardERC20_,
            tradingRange_,
            oracleTimeout_,
            targetName_,
            defaultThreshold_,
            delayUntilDefault_
        )
    {}

    function setSoftDefaultCheck(bool on) external {
        checkSoftDefault = on;
    }

    function setHardDefaultCheck(bool on) external {
        checkHardDefault = on;
    }

    /// Refresh exchange rates and update default status.
    function refresh() external virtual override {
        if (whenDefault <= block.timestamp) return;
        CollateralStatus oldStatus = status();

        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (checkHardDefault && referencePrice < prevReferencePrice) {
            whenDefault = block.timestamp;
        } else if (checkSoftDefault) {
            try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
                priceable = true;

                // Check for soft default of underlying reference token
                // D18{UoA/ref} = D18{UoA/target} * D18{target/ref} / D18
                uint192 peg = (pricePerTarget() * targetPerRef()) / FIX_ONE;

                // D18{UoA/ref}= D18{UoA/ref} * D18{1} / D18
                uint192 delta = (peg * defaultThreshold) / FIX_ONE; // D18{UoA/ref}

                // If the price is below the default-threshold price, default eventually
                // uint192(+/-) is the same as Fix.plus/minus
                if (p < peg - delta || p > peg + delta) {
                    whenDefault = Math.min(block.timestamp + delayUntilDefault, whenDefault);
                } else whenDefault = NEVER;
            } catch {
                priceable = false;
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }
}
