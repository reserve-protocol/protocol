// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/interfaces/IERC20Receiver.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/libraries/Auction.sol";
import "contracts/p0/TraderP0.sol";
import "contracts/p0/main/VaultHandlerP0.sol";

/// The RevenueTrader converts all asset balances at its address to a single target asset,
/// and transfers this to either the Furnace or StRSR.
contract RevenueTraderP0 is TraderP0 {
    using SafeERC20 for IERC20;

    Fate public fate; // MELT or STAKE

    constructor(VaultHandlerP0 main_, Fate fate_) TraderP0(main_) {
        require(fate_ == Fate.STAKE || fate_ == Fate.MELT, "only melting or staking");
        fate = fate_;
    }

    function poke() public override returns (bool) {
        return TraderP0.poke() || _startRevenueAuctions();
    }

    /// Start auctions selling all asset types to purchase RSR or RToken
    /// @return trading Whether an auction was launched
    function _startRevenueAuctions() private returns (bool trading) {
        IAsset[] memory assets = main.allAssets(); // includes RToken/RSR/COMP/AAVE
        IAsset buyAsset = fate == Fate.STAKE ? main.rsrAsset() : main.rTokenAsset();

        bool launch;
        Auction.Info memory auction;
        for (uint256 i = 0; i < assets.length; i++) {
            uint256 bal = assets[i].erc20().balanceOf(address(this));

            if (assets[i] == buyAsset) {
                // Skip auction because it's already in the target asset
                address to = fate == Fate.STAKE
                    ? address(main.stRSR())
                    : address(main.revenueFurnace());
                buyAsset.erc20().safeApprove(to, bal);
                IERC20Receiver(to).receiveERC20(buyAsset.erc20(), bal);
            } else {
                // If not dust, trade the non-target asset for the target asset
                (launch, auction) = _prepareAuctionSell(assets[i], buyAsset, bal, fate);
                if (launch) {
                    trading = true;
                    _launchAuction(auction);
                }
            }
        }
    }
}
