// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * Simple generalized trading interface for all Trade contracts to obey
 *
 * Usage: if (canSettle()) settle()
 */
interface ITrade {
    function sell() external view returns (IERC20Metadata);

    function buy() external view returns (IERC20Metadata);

    /// @return The timestamp at which the trade is projected to become settle-able
    function endTime() external view returns (uint48);

    /// @return True if the trade can be settled
    /// @dev Should be guaranteed to be true eventually as an invariant
    function canSettle() external view returns (bool);

    /// Complete the trade and transfer tokens back to the origin trader
    /// @return soldAmt {qSellTok} The quantity of tokens sold
    /// @return boughtAmt {qBuyTok} The quantity of tokens bought
    function settle() external returns (uint256 soldAmt, uint256 boughtAmt);
}
