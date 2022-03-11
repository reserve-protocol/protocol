// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ITrade {
    function sell() external view returns (IERC20);

    function buy() external view returns (IERC20);

    function endTime() external view returns (uint256);

    /// @return True if the trade can be settled; should be guaranteed eventually
    function canSettle() external view returns (bool);

    /// Settle trade, transfer tokens to trader, and snitch on the trade mechanism if needed
    function settle() external returns (uint256 soldAmt, uint256 boughtAmt);
}
