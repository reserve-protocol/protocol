// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./IMarket.sol";
import "./ITrader.sol";

enum AuctionState {
    NOT_STARTED,
    OPEN,
    CLOSED
}

interface IAuction {
    /// Can only be called once, and only by its Trader
    function open(
        IMarket market,
        ProposedAuction memory auction,
        uint256 endTime
    ) external;

    /// @return If the auction can be closed successfully
    function canClose() external view returns (bool);

    /// Can only be called once, and only by its Trader
    /// @return success True if the auction mechanism cleared at acceptable prices
    function close()
        external
        returns (
            bool success,
            uint256 soldAmt,
            uint256 boughtAmt
        );

    function sell() external view returns (IERC20);

    function buy() external view returns (IERC20);
}
