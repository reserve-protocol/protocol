// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

interface IRToken {
    /// Only callable by Owner.
    function changeConfiguration(address newConf) external;

    function takeSnapshot() external returns (uint256);

    /// Adaptation function, callable by anyone
    function act() external;

    /// Handles issuance.
    /// Requires approvals to be in place beforehand.
    function issue(uint256 amount) external;

    /// Handles redemption.
    function redeem(uint256 amount) external;

    /// Global trading freeze, callable by anyone
    function freezeTrading() external;

    function unfreezeTrading() external;

    /// =========================== Views =================================

    function stakingDepositDelay() external view returns (uint256);

    function stakingWithdrawalDelay() external view returns (uint256);

    function tradingFrozen() external view returns (bool);

    /// Returns the amounts of collateral tokens required to issue `amount` quantity
    function issueAmounts(uint256 amount) external view returns (uint256[] memory);

    /// Returns the amounts of collateral tokens to be paid during a redemption
    function redemptionAmounts(uint256 amount) external view returns (uint256[] memory);

    function adjustedAmountForFee(
        address from,
        address to,
        uint256 amount
    ) external returns (uint256);

    event ConfigUpdated(); // this feels weird
    event SlowMintingInitiated(address account, uint256 amount);
    event SlowMintingComplete(address account, uint256 amount);
    event Redemption(address indexed redeemer, uint256 indexed amount);
    event TradingFrozen(address indexed account);
    event TradingUnfrozen(address indexed account);

}
