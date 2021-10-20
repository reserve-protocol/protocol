// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IVault.sol";

library Auction {
    using SafeERC20 for IERC20;

    struct Info {
        IERC20 sellToken;
        IERC20 buyToken;
        uint256 sellAmount;
        uint256 minBuyAmount;
        uint256 startTime;
        uint256 endTime;
        address destination;
        bool open;
    }

    function start(Auction.Info storage self) internal {
        // TODO
        self.open = true;
    }

    function closeOut(Auction.Info storage self) internal {
        require(self.open, "already closed out");
        // TODO: batchAuction.claim();
        self.buyToken.safeTransfer(self.destination, self.buyToken.balanceOf(address(this)));
        self.open = false;
    }
}
