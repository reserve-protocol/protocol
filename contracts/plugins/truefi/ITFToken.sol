// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

/// External Interface for TFTokens and TrueMultiFarm contract.
/// Interface for only the required functions are implemented here.
/// tfUSDC contract: https://etherscan.io/address/0xA991356d261fbaF194463aF6DF8f0464F8f1c742
/// TrueMultiFarm contract: https://etherscan.io/address/0xec6c3FD795D6e6f202825Ddb56E01b3c128b0b10

interface ITFToken {
    /// @dev From TrueFi Docs:
    /// The current pool value in underlying token.
    function poolValue() external view returns (uint256);

    /// @dev The current total supply of the token.
    function totalSupply() external view returns (uint256);
}

interface ITRUFarm {
    /// @dev From TrueFi Docs (TrueMultiFarm contract):
    /// Number of accrued TRU rewards.
    function claimable(address token, address account) external view returns (uint256);
    
    /// @dev Lenders can claim TRU rewards using claim()
    function claim(address[] calldata tokens) external;

    /// @dev Contract address of the reward token (TRU)
    function rewardToken() external view returns (address);
}
