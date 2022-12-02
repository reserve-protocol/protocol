// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.9;

interface IReservefCashWrapper {
    /// @notice Returns the ratio of appreciation of the deposited assets of the calling account.
    /// @return rate The ratio of value of a deposited token to what it's currently worth
    function refPerTok(address account) external view returns (uint256 rate);

    /// @notice Checks every position the account is in, and if any of the markets
    ///   has matured, redeems the underlying assets and re-lends everything again
    function reinvest() external;
}

