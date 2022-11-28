// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;
pragma experimental ABIEncoderV2;

/**
 * @title ConfigOptions
 * @notice A central place for enumerating the configurable options of our GoldfinchConfig contract
 * @author Goldfinch
 */

library ConfigOptions {
    // NEVER EVER CHANGE THE ORDER OF THESE!
    // You can rename or append. But NEVER change the order.
    enum Numbers {
        TransactionLimit,
        /// @dev: TotalFundsLimit used to represent a total cap on senior pool deposits
        /// but is now deprecated
        TotalFundsLimit,
        MaxUnderwriterLimit,
        ReserveDenominator,
        WithdrawFeeDenominator,
        LatenessGracePeriodInDays,
        LatenessMaxDays,
        DrawdownPeriodInSeconds,
        TransferRestrictionPeriodInDays,
        LeverageRatio
    }
    /// @dev TrustedForwarder is deprecated because we no longer use GSN. CreditDesk
    ///   and Pool are deprecated because they are no longer used in the protocol.
    enum Addresses {
        Pool, // deprecated
        CreditLineImplementation,
        GoldfinchFactory,
        CreditDesk, // deprecated
        Fidu,
        USDC,
        TreasuryReserve,
        ProtocolAdmin,
        OneInch,
        TrustedForwarder, // deprecated
        CUSDCContract,
        GoldfinchConfig,
        PoolTokens,
        TranchedPoolImplementation, // deprecated
        SeniorPool,
        SeniorPoolStrategy,
        MigratedTranchedPoolImplementation,
        BorrowerImplementation,
        GFI,
        Go,
        BackerRewards,
        StakingRewards,
        FiduUSDCCurveLP,
        TranchedPoolImplementationRepository
    }
}
