// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../external/zeppelin/token/ERC20/IERC20.sol";
import "./ISlowMintingERC20.sol";

interface IRToken is ISlowMintingERC20 {

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

    function tradingFrozen() external view returns (bool);

    function isFullyCollateralized() external view returns (bool);

    /// Returns index of least collateralized token, or -1 if fully collateralized.
    function leastCollateralized() external view returns (int256);

    /// Returns the index of the most collateralized token, or -1.
    function mostCollateralized() external view returns (int256);

    /// Returns the amounts of collateral tokens required to issue `amount` quantity
    function issueAmounts(uint256 amount) external view returns (uint256[] memory);

    /// Returns the amounts of collateral tokens to be paid during a redemption
    function redemptionAmounts(uint256 amount) external view returns (uint256[] memory);

    function adjustedAmountForFee(address from, address to, uint256 amount) external returns (uint256);

    event Issuance(address indexed issuer, uint256 indexed amount);
    event Redemption(address indexed redeemer, uint256 indexed amount);
    event ConfigurationChanged(address indexed oldConfiguration, address indexed newConfiguration);
    event TradingFrozen(address indexed account);
    event TradingUnfrozen(address indexed account);

}
