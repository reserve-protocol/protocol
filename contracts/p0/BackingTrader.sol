// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/main/BasketHandler.sol";
import "contracts/p0/Trader.sol";
import "contracts/libraries/Fixed.sol";

contract BackingTraderP0 is TraderP0 {
    using FixLib for Fix;
    using SafeERC20 for IERC20Metadata;

    // How many more BUs this trader has the duty to construct.
    Fix public targetBUs; // {BU}

    // solhint-disable-next-line no-empty-blocks
    constructor(IMain main_) TraderP0(main_) {}

    function poke() public override {
        // First, try to close open auctions.
        closeDueAuctions();

        // If no auctions are open, try creating BUs.
        if (!hasOpenAuctions() && targetBUs.gt(FIX_ZERO)) {
            _tryCreateBUs();
            _startNextAuction();
        }

        // If we're here, we're done trading. Clear out any remaining RSR to the staking pool.
        if (!hasOpenAuctions() && main.fullyCapitalized()) {
            IAsset[] memory assets = main.allAssets();
            for (uint256 i = 0; i < assets.length; i++) {
                IERC20Metadata tok = assets[i].erc20();
                uint256 bal = tok.balanceOf(address(this));
                if (bal == 0) {
                    continue;
                }

                if (tok == main.rsr()) {
                    tok.safeApprove(address(main), bal);
                    main.distribute(tok, address(this), bal);
                } else {
                    tok.safeTransfer(main.rTokenTraderAddr(), bal);
                }
            }
        }
    }

    function increaseBUTarget(Fix amtBUs, Fix maxTarget) external {
        require(_msgSender() == address(main), "main only");
        targetBUs = fixMax(targetBUs.plus(amtBUs), maxTarget);
    }

    /// Launch auctions to reach BUTarget. Use RSR if needed.
    function _startNextAuction() private {
        if (targetBUs.eq(FIX_ZERO)) {
            return;
        }
        // Is there a collateral surplus?
        //     Yes: Try to trade surpluses for deficits
        //     No: Seize RSR and trade for deficit

        // Are we able to trade sideways, or is it all dust?
        (
            IAsset surplus,
            IAsset deficit,
            uint256 surplusAmount,
            uint256 deficitAmount
        ) = _largestSurplusAndDeficit();

        bool trade;
        Auction memory auction;
        if (
            surplus.isCollateral() &&
            ICollateral(address(surplus)).status() == CollateralStatus.SOUND
        ) {
            (trade, auction) = _prepareAuctionToCoverDeficit(
                surplus,
                deficit,
                surplusAmount,
                deficitAmount
            );
        } else {
            (trade, auction) = _prepareAuctionSell(surplus, deficit, surplusAmount);
            auction.minBuyAmount = 0;
        }
        if (trade) {
            _launchAuction(auction);
        }

        // If we're here, all the surplus is dust and we're still recapitalizing
        // So it's time to seize and spend staked RSR
        (trade, auction) = _prepareAuctionToCoverDeficit(
            main.rsrAsset(),
            deficit,
            main.rsr().balanceOf(address(main.stRSR())), // max(RSR that can be seized)
            deficitAmount
        );
        if (trade) {
            uint256 balance = main.rsr().balanceOf(address(this));
            if (auction.sellAmount > balance) {
                main.stRSR().seizeRSR(auction.sellAmount - balance);
            }
            _launchAuction(auction);
        }
    }

    /// Determines what the largest collateral-for-collateral trade is.
    /// Algorithm:
    ///    1. Target a number of basket units, based on total value held by all collateral.
    ///    2. Choose the most in-surplus and most in-deficit assets for trading.
    /// @return surplus Surplus asset
    /// @return deficit Deficit asset
    /// @return surplusAmount {qSellTok} Surplus amount
    /// @return deficitAmount {qBuyTok} Deficit amount
    function _largestSurplusAndDeficit()
        private
        view
        returns (
            IAsset surplus,
            IAsset deficit,
            uint256 surplusAmount,
            uint256 deficitAmount
        )
    {
        IAsset[] memory assets = main.allAssets();

        // Calculate surplus and deficits relative to the BU target.
        Fix[] memory surpluses = new Fix[](assets.length);
        Fix[] memory deficits = new Fix[](assets.length);
        uint256[] memory amounts = main.basketCollateralQuantities();
        for (uint256 i = 0; i < assets.length; i++) {
            // {qTok}
            Fix bal = toFix(IERC20(assets[i].erc20()).balanceOf(address(this)));

            Fix target;
            if (assets[i].isCollateral()) {
                // {qTok} = {BU} * {qTok/BU}
                target = targetBUs.mulu(amounts[i]);
            }

            if (bal.gt(target)) {
                // {attoUSD} = ({qTok} - {qTok}) * {attoUSD/qTok}
                surpluses[i] = bal.minus(target).mul(assets[i].price());
            } else if (bal.lt(target)) {
                // {attoUSD} = ({qTok} - {qTok}) * {attoUSD/qTok}
                deficits[i] = target.minus(bal).mul(assets[i].price());
            }
        }

        // Calculate the maximums.
        uint256 surplusIndex;
        uint256 deficitIndex;
        Fix surplusMax; // {attoUSD}
        Fix deficitMax; // {attoUSD}
        for (uint256 i = 0; i < assets.length; i++) {
            if (surpluses[i].gt(surplusMax)) {
                surplusMax = surpluses[i];
                surplusIndex = i;
            }
            if (deficits[i].gt(deficitMax)) {
                deficitMax = deficits[i];
                deficitIndex = i;
            }
        }

        // {qSellTok} = {attoUSD} / {attoUSD/qSellTok}
        Fix sellAmount = surplusMax.div(assets[surplusIndex].price());

        // {qBuyTok} = {attoUSD} / {attoUSD/qBuyTok}
        Fix buyAmount = deficitMax.div(assets[deficitIndex].price());
        return (assets[surplusIndex], assets[deficitIndex], sellAmount.floor(), buyAmount.floor());
    }

    function _tryCreateBUs() private {
        // TODO all of this is incoherent now
        // Create new BUs
        // uint256 issuable = main.vault().maxIssuable(address(this));
        // address[] memory erc20s = main.backingTokens();
        // if (issuable > 0) {
        //     uint256[] memory amounts = main.quote(issuable);
        //     for (uint256 i = 0; i < amounts.length; i++) {
        //         IERC20Metadata(erc20s[i]).safeApprove(address(main), amounts[i]);
        //     }
        //     main.vault().issue(address(main), issuable);
        //     targetBUs = targetBUs.minus(fixMin(toFix(issuable), targetBUs));
        // }
    }
}
