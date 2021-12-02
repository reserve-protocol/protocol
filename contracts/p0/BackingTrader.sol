// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/p0/libraries/Auction.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IVault.sol";
import "contracts/p0/Trader.sol";

contract BackingTrader is Trader {
    uint256 public targetBUs;

    /// @return Whether an auction is live
    function poke() external override returns (bool trading) {
        trading = super.poke();
        if (!trading) {
            _tryCreateBUs();
            trading = _startNextAuction();
        }
    }

    function increaseBUTarget(uint256 amtBUs, uint256 maxTarget) external {
        require(_msgSender() == address(main), "main only");
        targetBUs = Math.max(targetBUs + amtBUs, maxTarget);
    }

    /// Launch auctions to reach BUTarget using RSR as needed
    /// @return Whether an auction was launched
    function _startNextAuction() internal returns (bool) {
        if (targetBUs == 0) {
            return false;
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
        Auction.Info memory auction;
        if (_isTrustedPrice(surplus)) {
            (trade, auction) = _prepareAuctionBuy(
                main.minRecapitalizationAuctionSize(),
                surplus,
                deficit,
                surplusAmount,
                deficitAmount,
                Fate.Stay
            );
        } else {
            (trade, auction) = _prepareAuctionSell(
                main.minRecapitalizationAuctionSize(),
                surplus,
                deficit,
                surplusAmount,
                Fate.Stay
            );
            auction.minBuyAmount = 0;
        }
        if (trade) {
            _launchAuction(auction);
            return true;
        }

        // If we're here, all the surplus is dust and we're still recapitalizing
        // TODO: RSR case
    }

    /// Determines what the largest collateral-for-collateral trade is.
    /// Algorithm:
    ///    1. Target a particular number of basket units based on total fiatcoins held across all collateral.
    ///    2. Choose the most in-surplus and most in-deficit assets for trading.
    /// @return Surplus asset
    /// @return Deficit asset
    /// @return {qSellTok} Surplus amount
    /// @return {qBuyTok} Deficit amount
    function _largestSurplusAndDeficit()
        private
        returns (
            IAsset surplus,
            IAsset deficit,
            uint256 surplusAmount,
            uint256 dificitAmount
        )
    {
        IAsset[] memory assets = main.allAssets();

        // Calculate surplus and deficits relative to the BU target.
        Fix[] memory surpluses = new Fix[](assets.length);
        Fix[] memory deficits = new Fix[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            Fix bal = toFix(IERC20(assets[i].erc20()).balanceOf(address(this))); // {qTok}

            // {qTok} = {BU} * {qTok/BU}
            Fix target = toFix(targetBUs).mulu(vault.quantity(assets[i]));
            if (bal.gt(target)) {
                // {attoUSD} = ({qTok} - {qTok}) * {attoUSD/qTok}
                surpluses[i] = bal.minus(target).mul(assets[i].priceUSD(oracle()));
            } else if (bal.lt(target)) {
                // {attoUSD} = ({qTok} - {qTok}) * {attoUSD/qTok}
                deficits[i] = target.minus(bal).mul(assets[i].priceUSD(oracle()));
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
        Fix sellAmount = surplusMax.div(assets[surplusIndex].priceUSD(oracle()));

        // {qBuyTok} = {attoUSD} / {attoUSD/qBuyTok}
        Fix buyAmount = deficitMax.div(assets[deficitIndex].priceUSD(oracle()));
        return (
            assets[surplusIndex],
            assets[deficitIndex],
            sellAmount.toUint(),
            buyAmount.toUint()
        );
    }

    function _isTrustedPrice(IAsset asset) private returns (bool) {
        return
            main.isApproved(asset) ||
            asset == main.rTokenAsset() ||
            asset == main.rsrAsset() ||
            asset == main.compAsset() ||
            asset == main.aaveAsset();
    }

    function _tryCreateBUs() private {
        // Create new BUs
        uint256 issuable = main.vault().maxIssuable(address(this));
        if (issuable > 0) {
            uint256[] memory amounts = main.vault().tokenAmounts(issuable);
            for (uint256 i = 0; i < amounts.length; i++) {
                main.vault().collateralAt(i).erc20().safeApprove(address(main.vault()), amounts[i]);
            }
            vault.issue(address(main), issuable);
            targetBUs -= Math.min(issuable, targetBUs);
        }
    }
}
