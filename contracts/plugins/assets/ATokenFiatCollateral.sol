// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";

// ==== External ====

// External interfaces from: https://git.io/JX7iJ
interface IStaticAToken is IERC20Metadata {
    function claimRewardsToSelf(bool forceUpdate) external;

    // @return RAY{fiatTok/tok}
    function rate() external view returns (uint256);

    // solhint-disable-next-line func-name-mixedcase
    function ATOKEN() external view returns (AToken);

    function getClaimableRewards(address user) external view returns (uint256);
}

interface AToken {
    // solhint-disable-next-line func-name-mixedcase
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
}

// ==== End External ====

/**
 * @title ATokenFiatCollateral
 * @notice Collateral plugin for an aToken for a UoA-pegged asset, like aUSDC or a aUSDP
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract ATokenFiatCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        IERC20Metadata rewardERC20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_
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
        require(address(rewardERC20_) != address(0), "rewardERC20 missing");
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        defaultThreshold = defaultThreshold_;

        prevReferencePrice = refPerTok();
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function price() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        return chainlinkFeed.price(oracleTimeout).mul(refPerTok());
    }

    /// Refresh exchange rates and update default status.
    function refresh() external virtual override {
        if (whenDefault <= block.timestamp) return;
        CollateralStatus oldStatus = status();

        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (referencePrice < prevReferencePrice) {
            whenDefault = block.timestamp;
        } else {
            try this.price() returns (uint192 p) {
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
                whenDefault = Math.min(block.timestamp + delayUntilDefault, whenDefault);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        uint256 rateInRAYs = IStaticAToken(address(erc20)).rate(); // {ray ref/tok}
        return shiftl_toFix(rateInRAYs, -27);
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
        _to = address(erc20); // this should be a StaticAToken
        _cd = abi.encodeWithSignature("claimRewardsToSelf(bool)", true);
    }
}
