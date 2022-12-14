// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/RevenueHiding.sol";
import "contracts/plugins/goldfinch/IGoldfinch.sol";
import "contracts/plugins/goldfinch/GoldfinchConfigOptions.sol";

interface IGoldFinchStakingWrapper is IERC20Metadata {
    function claimRewards(bool, address) external;

    // solhint-disable-next-line func-name-mixedcase
    function REWARD_TOKEN() external view returns (IERC20);
}

/**
 * @title GoldfinchSeniorPoolCollateral
 * @notice Collateral plugin for a Goldfinch Senior Pool tokens
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract GoldfinchSeniorPoolCollateral is RevenueHiding {
    using ConfigOptions for IGoldfinchConfig;
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    uint192 public withdrawalFeeDenominator;

    IGoldfinchSeniorPool public immutable goldfinch;
    IGoldfinchConfig public immutable goldfinchConfig;

    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        IGoldfinchSeniorPool goldfinch_,
        uint192 allowedDropBasisPoints_
    )
        RevenueHiding(
            fallbackPrice_,
            chainlinkFeed_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_,
            allowedDropBasisPoints_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");

        require(address(goldfinch_) != address(0), "!goldfinch");
        defaultThreshold = defaultThreshold_;

        goldfinch = goldfinch_;
        goldfinchConfig = goldfinch.config();

        withdrawalFeeDenominator = uint192(
            goldfinchConfig.getNumber(uint256(ConfigOptions.Numbers.WithdrawFeeDenominator))
        ); // SHOULD remain at 200 (0.5% withdrawal fee)

        maxRefPerTok = actualRefPerTok();
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev delegatecall
    function claimRewards() external virtual override {
        IERC20 gfi = IGoldFinchStakingWrapper(address(erc20)).REWARD_TOKEN();
        uint256 oldBal = gfi.balanceOf(address(this));
        IGoldFinchStakingWrapper(address(erc20)).claimRewards(true, address(this));
        emit RewardsClaimed(gfi, gfi.balanceOf(address(this)) - oldBal);
    }

    /// @dev Manual update to Goldfinch's withdrawal fee
    /// Not expected to ever be called and safe to be called by anyone
    function updateWithdrawalFeeDenominator() external {
        withdrawalFeeDenominator = uint192(
            goldfinchConfig.getNumber(uint256(ConfigOptions.Numbers.WithdrawFeeDenominator))
        );
    }

    /// Goldfinch share price less the withdrawal fee
    function actualRefPerTok() public view override returns (uint192) {
        uint256 rate = goldfinch.sharePrice();
        uint192 withdrawalFee = uint192(rate) / withdrawalFeeDenominator;

        return shiftl_toFix(rate - withdrawalFee, -18);
    }

    function checkReferencePeg() internal override {
        try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
            // Check for soft default of underlying reference token
            // D18{UoA/ref} = D18{UoA/target} * D18{target/ref} / D18
            uint192 peg = (pricePerTarget() * targetPerRef()) / FIX_ONE;

            // D18{UoA/ref}= D18{UoA/ref} * D18{1} / D18
            uint192 delta = (peg * defaultThreshold) / FIX_ONE; // D18{UoA/ref}

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
}
