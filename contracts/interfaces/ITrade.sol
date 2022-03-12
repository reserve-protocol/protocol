// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Independent of trading marketplace all oneshot trade contracts must adhere to this interface
interface ITrade {
    function sell() external view returns (IERC20);

    function buy() external view returns (IERC20);

    function endTime() external view returns (uint256);

    /// @return True if the trade can be settled; should be guaranteed to be true eventually
    function canSettle() external view returns (bool);

    /// Settle trade, transfer tokens to trader, and report bad trade if needed
    function settle() external returns (uint256 soldAmt, uint256 boughtAmt);
}
