// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/p0/interfaces/IERC20Receiver.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/Trader.sol";

/// The RevenueTrader converts all asset balances at its address to a single target asset
/// and sends this asset to the RevenueDistributor at Main.
contract RevenueTraderP0 is TraderP0 {
    using SafeERC20 for IERC20Metadata;

    IAsset public immutable assetToBuy;

    constructor(address main_, IAsset assetToBuy_) TraderP0() {
        initTrader(main_);
        assetToBuy = assetToBuy_;
    }

    function poke() public {
        // Always process auctions *and* do funds management; don't short-circuit here.
        closeDueAuctions();
    }

    /// Claims and sweeps all rewards
    function claimAndSweepRewardsToMain() external returns (uint256[] memory) {
        (address[] memory erc20s, uint256[] memory amts) = RewardsLib.claimRewards(address(main));
        for (uint256 i = 0; i < erc20s.length; i++) {
            IERC20Metadata(erc20s[i]).safeTransfer(address(main), amts[i]);
        }
        return amts;
    }

    /// Trigger auction of token for assetToBuy.
    /// @return whether an auction was triggered
    function triggerAuction(IERC20Metadata token) external returns (bool) {
        IAsset asset = main.activeAsset(address(token));
        uint256 bal = token.balanceOf(address(this));
        if (bal == 0) return false;

        if (asset == assetToBuy) {
            token.safeApprove(address(main), bal);
            main.distribute(token, address(this), bal);
            return false;
        }

        // Don't open a second auction if there's already one running.
        for (uint256 i = 0; i < auctions.length; i++) {
            if (auctions[i].sell == asset && auctions[i].status != AuctionStatus.DONE) return false;
        }

        // {tok} =  {qTok} / {qTok/tok}
        Fix sellAmt = toFixWithShift(bal, -int8(token.decimals()));
        (bool launch, Auction memory auction) = prepareAuctionSell(asset, assetToBuy, sellAmt);
        if (launch) launchAuction(auction);
        return launch;
    }
}
