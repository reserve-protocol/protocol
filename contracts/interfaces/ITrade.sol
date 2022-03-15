// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// All Trade contracts deployed by the Broker must adhere to this interface.
interface ITrade {
    function sell() external view returns (IERC20);

    function buy() external view returns (IERC20);

    /// @return The timestamp at which the trade is projected to become settle-able
    function endTime() external view returns (uint256);

    /// @return True if the trade can be settled
    /// @dev Should be guaranteed to be true eventually as an invariant
    function canSettle() external view returns (bool);

    /// Complete the trade and transfer tokens back to the origin trader
    function settle() external returns (uint256 soldAmt, uint256 boughtAmt);
}
