// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

interface IIssuance {

    /// callable by anyone
    function noop() external;

    /// Handles issuance.
    /// Requires approvals to be in place beforehand.
    function issue(uint256 amount) external;

    /// Handles redemption.
    function redeem(uint256 amount) external;

    /// Global trading freeze, callable by anyone
    function freezeTrading() external;

    function unfreezeTrading() external;

    /// =========================== Views =================================

    function tradingFrozen() external view returns (bool);

    /// Returns the amounts of collateral tokens required to issue `amount` quantity
    function issueAmounts(uint256 amount) external view returns (uint256[] memory);

    /// Returns the amounts of collateral tokens to be paid during a redemption
    function redemptionAmounts(uint256 amount) external view returns (uint256[] memory);

    event SlowMintingInitiated(address account, uint256 amount);
    event SlowMintingComplete(address account, uint256 amount);
    event Redemption(address indexed redeemer, uint256 indexed amount);
    event TradingFrozen(address indexed account);
    event TradingUnfrozen(address indexed account);
}
