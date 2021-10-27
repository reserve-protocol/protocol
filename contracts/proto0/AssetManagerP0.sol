// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../Ownable.sol"; // temporary
// import "@openzeppelin/contracts/access/Ownable.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../libraries/CommonErrors.sol";
import "./libraries/Auction.sol";
import "./libraries/SlowIssuance.sol";
import "./interfaces/IRToken.sol";
import "./interfaces/IVault.sol";
import "./interfaces/IAsset.sol";
import "./interfaces/IAssetManager.sol";
import "./FurnaceP0.sol";
import "./RTokenP0.sol";
import "./StakingPoolP0.sol";

/**
 * @title AssetManagerP0
 * @dev Handles the transfer and trade of assets.
 *
 * This contract:
 *    - Manages the choice of backing of an RToken via Vault selection.
 *    - Defines the exchange rate between Vault BUs and RToken supply, via the base factor.
 *    - Runs 3 types of auctions:
 *          A. Asset-for-asset             (Migration auctions)
 *          B. RSR-for-RToken              (Recapitalization auctions)
 *          C. COMP/AAVE-for-RToken        (Revenue auctions)
 */
contract AssetManagerP0 is IAssetManager, Ownable {
    using SafeERC20 for IERC20;
    using SlowIssuance for SlowIssuance.Info;
    using Auction for Auction.Info;
    using EnumerableSet for EnumerableSet.AddressSet;

    uint256 public constant SCALE = 1e18;

    // ECONOMICS (Note that SCALE is ignored here. These are the abstract mathematical relationships)
    //
    // base factor = exchange rate between Vault BUs and RTokens
    // base factor = b = _meltingRatio / _basketDilutionRatio
    // _meltingRatio = (total supply + melting) / total supply
    // _basketDilutionRatio = _currentBasketDilution * _historicalBasketDilution
    // <RToken> = b * <Basket Unit Vector>
    // Fully capitalized: #RTokens <= #BUs / b

    // Basket Dilution
    uint256 internal _currentBasketDilution = 1e18; // for this current vault, since the last time *f* was changed
    uint256 internal _historicalBasketDilution = 1e18; // the product of all historical basket dilutions
    uint256 internal _prevBasketFiatcoinRate; // redemption value of the basket in fiatcoins last update

    EnumerableSet.AddressSet internal _approvedAssets;
    EnumerableSet.AddressSet internal _allAssets;
    EnumerableSet.AddressSet internal _fiatcoins;

    IMain public main;
    IVault public override vault;

    // Append-only record keeping
    IVault[] public pastVaults;
    mapping(uint256 => SlowIssuance.Info) public issuances;
    uint256 public issuanceCount;
    mapping(uint256 => Auction.Info) public auctions;
    uint256 public auctionCount;

    constructor(
        IMain main_,
        IVault vault_,
        address owner_,
        IAsset[] memory approvedAssets_
    ) {
        main = main_;
        _transferOwnership(owner_);
        vault = vault_;
        for (uint256 i = 0; i < approvedAssets_.length; i++) {
            approveAsset(approvedAssets_[i]);
        }
        if (!vault.containsOnly(_approvedAssets.values())) {
            revert CommonErrors.UnapprovedAsset();
        }
        accumulate();
        main.rsr().approve(address(staking), type(uint256).max);
    }

    modifier onlyMain() {
        require(_msgSender() == address(main), "main only");
        _;
    }

    // This modifier runs before every function including redemption, so it needs to be very safe.
    modifier always() {
        main.furnace().doBurn();
        _diluteBasket();
        _;
    }

    function issue(address issuer, uint256 amount) external override onlyMain always {
        _processSlowIssuance();
        IRToken r = main.rToken();
        uint256 issuanceRate = Math.max(10_000 * 10**r.decimals(), (r.totalSupply() * main.issuanceRate()) / SCALE);
        uint256 numBlocks = Math.ceilDiv(amount, issuanceRate);

        // Calculate block the issuance should be made available.
        uint256 blockStart = issuanceCount == 0 ? block.number : issuances[issuanceCount - 1].blockAvailableAt;
        uint256 blockEnd = Math.max(blockStart, block.number) + numBlocks;

        // Mint the RToken now and hold onto it while the slow issuance vests
        SlowIssuance.Info storage issuance = issuances[issuanceCount];
        issuance.start(vault, amount, _toBUs(amount), issuer, numBlocks);
        r.mint(address(this), amount);
        issuanceCount++;
    }

    function redeem(address redeemer, uint256 amount) external override onlyMain always {
        if (!main.paused()) {
            _processSlowIssuance();
        }
        main.rToken().burn(redeemer, amount);
        _oldestNonEmptyVault().redeem(redeemer, _toBUs(amount));
    }

    // Continually runs auctions as long as we are undercollateralized.
    // Algorithm:
    //     1. Closeout previous auctions
    //     2. Create BUs from asset
    //     3. Break off BUs from the old vault for asset
    //     4. Launch a asset-for-asset auction until we are left with dust
    //     5. If it's all dust: sell RSR and buy RToken and burn it
    //     6. If we run out of RSR: give RToken holders a haircut to get back to capitalized
    function runAuctions() external override onlyMain always returns (State) {
        _processSlowIssuance();

        // Halt if an auction is ongoing
        Auction.Info storage prev = auctionCount > 0 ? auctions[auctionCount - 1] : auctions[0];
        if (prev.open) {
            if (block.timestamp <= prev.endTime) {
                return;
            }

            // Closeout auction and check that prices are reasonable (for asset-for-asset auctions).
            uint256 buyAmount = prev.closeOut(_config.rewardPeriod);
            if (
                address(prev.sellCollateral) != address(0) &&
                address(prev.buyCollateral) != address(0) &&
                !prev.clearedCloseToOraclePrice(SCALE, buyAmount, _config.auctionClearingTolerance())
            ) {
                // Enter precautionary state
                return State.PRECAUTIONARY;
            }
        }

        // Create as many BUs as we can
        uint256 issuable = vault.maxIssuable(address(this));
        if (issuable > 0) {
            vault.issue(issuable);
        }

        // Halt if paused or capitalized
        if (fullyCapitalized()) {
            return STATE.CALM;
        }

        // Are we able to trade sideways, or is it all dust?
        (bool trade, IAsset sell, IAsset buy, uint256 sellAmount, uint256 minBuy) = _getCollateralTrade();

        // If we are in the Migration state, redeem BUs to open up spare asset
        uint256 totalSupply = main.rToken().totalSupply();
        IVault oldVault = _oldestNonEmptyVault();
        if (!trade && oldVault != vault) {
            uint256 max = _toBUs(((totalSupply) * _config.migrationChunk) / SCALE);
            uint256 chunk = Math.min(max, oldVault.basketUnits(address(this)));
            oldVault.redeem(address(this), chunk);

            // Decide whether to trade and exactly which trade.
            (trade, sell, buy, sellAmount, minBuy) = _getCollateralTrade();
        }
        address sellToken = sell.erc20();
        address buyToken = buy.erc20();
        address destination = address(this);

        uint256 stakedRSR = main.rsr().balanceOf(address(staking));
        if (!trade && stakedRSR > 0) {
            // Final backstop: Use RSR to buy back RToken and burn it.
            sellToken = address(main.rsr());
            buyToken = address(main.rToken());
            destination = address(0);

            uint256 rsrUSD = oracle.consultAave(address(main.rsr()));
            uint256 rTokenUSDEstimate = vault.basketFiatcoinRate();
            uint256 unbackedRToken = totalSupply - _fromBUs(vault.basketUnits(address(this)));
            minBuy = Math.min(unbackedRToken, (totalSupply * _config.maxAuctionSize) / SCALE);
            minBuy = Math.max(minBuy, (totalSupply * _config.minAuctionSize) / SCALE);
            sellAmount = (minBuy * rTokenUSDEstimate) / rsrUSD;
            sellAmount = ((sellAmount * SCALE) / (SCALE - _config.maxTradeSlippage));

            staking.seizeRSR(sellAmount - main.rsr().balanceOf(address(this)));
        } else if (!trade) {
            // We've reached the endgame...time to concede and give RToken holders a haircut.
            accumulate();
            _historicalBasketDilution = (_meltingRatio * vault.basketUnits(address(this))) / totalSupply;
            return;
        }

        // At this point in the code this is either a asset-for-asset trade or an RSR-for-RToken trade.
        uint256 auctionEnd = block.timestamp + _config.auctionPeriod;
        Auction.Info storage auction = auctions[auctionCount];
        auction.start(sell, buy, sellToken, buyToken, sellAmount, minBuy, auctionEnd, destination);
        auctionCount++;
        return STATE.MIGRATION;
    }

    //

    function approveAsset(IAsset asset) public onlyOwner {
        _approvedAssets.add(address(asset));
        _allAssets.add(address(asset));
        if (asset.isFiatcoin()) {
            _fiatcoins.add(address(asset));
        }
    }

    function unapproveAsset(IAsset asset) public onlyOwner {
        _approvedAssets.remove(address(asset));
        if (asset.isFiatcoin()) {
            _fiatcoins.remove(address(asset));
        }
    }

    // Unapproves the defaulting asset and switches the RToken over to a new Vault.
    function switchVaults(IAsset[] memory defaulting) public onlyMain {
        for (uint256 i = 0; i < defaulting.length; i++) {
            unapproveAsset(defaulting[i]);
        }

        IVault newVault = main.monitor().getNextVault(vault, _approvedAssets.values(), _fiatcoins.values());
        if (address(newVault) != address(0)) {
            pastVaults.push(vault);
            vault = newVault;

            // Accumulate the basket dilution factor to enable correct forward accounting
            accumulate();

            // Undo all open slowmintings
            _processSlowIssuance();
        }
    }

    // Upon vault change or change to *f*, we accumulate the historical dilution factor.
    // TODO: Is this acceptable? There's compounding error but so few number of times.
    function accumulate() public onlyMain {
        // Idempotent
        _diluteBasket();
        _historicalBasketDilution = (_historicalBasketDilution * _currentBasketDilution) / SCALE;
        _currentBasketDilution = SCALE;
        _prevBasketFiatcoinRate = vault.basketFiatcoinRate();
    }

    //

    function quote(uint256 amount) public view override returns (uint256[] memory) {
        require(amount > 0, "Cannot quote redeem zero");
        return vault.tokenAmounts(_toBUs(amount));
    }

    function fullyCapitalized() public view override returns (bool) {
        return vault.basketUnits(address(this)) >= _toBUs(main.rToken().totalSupply());
    }

    function allAssets() external view override returns (address[] memory) {
        return _allAssets.values();
    }

    function approvedAssets() external view override returns (address[] memory) {
        return _approvedAssets.values();
    }

    function fiatcoins() external view override returns (address[] memory) {
        return _fiatcoins.values();
    }

    //

    // RToken -> BUs
    function _toBUs(uint256 amount) internal view returns (uint256) {
        uint256 totalSupply = main.rToken().totalSupply();
        if (totalSupply == 0) {
            return amount;
        }
        uint256 melting = (SCALE * (totalSupply + main.furnace().totalBurnt())) / totalSupply;
        uint256 basketDilution = (_currentBasketDilution * _historicalBasketDilution) / SCALE;
        return (amount * basketDilution) / melting;
    }

    // BUs -> RToken
    function _fromBUs(uint256 amount) internal view returns (uint256) {
        uint256 totalSupply = main.rToken().totalSupply();
        if (totalSupply == 0) {
            return amount;
        }
        uint256 melting = (SCALE * (totalSupply + main.furnace().totalBurnt())) / totalSupply;
        uint256 basketDilution = (_currentBasketDilution * _historicalBasketDilution) / SCALE;
        return (amount * melting) / basketDilution;
    }

    // Returns the oldest vault that contains nonzero BUs.
    // Note that this will pass over vaults with uneven holdings, it does not necessarily mean the vault
    // contains no asset tokens.
    function _oldestNonEmptyVault() internal view returns (IVault) {
        for (uint256 i = 0; i < pastVaults.length; i++) {
            if (pastVaults[i].basketUnits(address(this)) > 0) {
                return pastVaults[i];
            }
        }
        return vault;
    }

    //

    // Processes all slow issuances that have fully vested, or undoes them if the vault has been changed.
    function _processSlowIssuance() internal {
        for (uint256 i = 0; i < issuanceCount; i++) {
            if (!issuances[i].processed && issuances[i].availableAt <= block.timestamp) {
                issuances[i].process(main.rToken(), vault);
            }
        }
    }

    // Reduces basket quantities slightly in order to pass through basket appreciation to stakers.
    // Uses a closed-form calculation that is anchored to the last time the vault or *f* was changed.
    // Idempotent
    function _diluteBasket() internal {
        uint256 current = vault.basketFiatcoinRate();
        _currentBasketDilution = SCALE + _config.f * ((SCALE * current) / _prevBasketFiatcoinRate - SCALE);
    }

    // Determines if a trade should be made and what it should be.
    // Algorithm:
    //     1. Target a particular number of basket units based on total fiatcoins held across all asset.
    //     2. Swap the most-in-excess asset for most-in-deficit.
    //     3. Confirm swap is for a large enough volume. We don't want to trade endlessly.
    function _getCollateralTrade()
        internal
        returns (
            bool shouldTrade,
            IAsset sell,
            IAsset buy,
            uint256 sellAmount,
            uint256 minBuyAmount
        )
    {
        // Calculate how many BUs we could create from all asset if we could trade with 0 slippage
        uint256 totalValue;
        uint256[] memory prices = new uint256[](_allAssets.length()); // USD with 18 decimals
        for (uint256 i = 0; i < _allAssets.length(); i++) {
            IAsset c = IAsset(_allAssets.at(i));
            prices[i] = (c.redemptionRate() * oracle.fiatcoinPrice(c)) / SCALE;
            totalValue += IERC20(c.erc20()).balanceOf(address(this)) * prices[i];
        }
        uint256 BUTarget = (totalValue * SCALE) / vault.basketFiatcoinRate();

        uint256[] memory surplus = new uint256[](_allAssets.length());
        uint256[] memory deficit = new uint256[](_allAssets.length());
        // Calculate surplus and deficits relative to the BU target.
        for (uint256 i = 0; i < _allAssets.length(); i++) {
            IAsset c = IAsset(_allAssets.at(i));
            uint256 bal = IERC20(c.erc20()).balanceOf(address(this));
            uint256 target = (vault.quantity(c) * BUTarget) / SCALE;
            if (bal > target) {
                surplus[i] = ((bal - target) * prices[i]) / SCALE;
            } else if (bal < target) {
                deficit[i] = ((target - bal) * prices[i]) / SCALE;
            }
        }

        // Calculate the maximums.
        uint256 sellIndex;
        uint256 buyIndex;
        uint256 surplusMax;
        uint256 deficitMax;
        for (uint256 i = 0; i < _allAssets.length(); i++) {
            if (surplus[i] > surplusMax) {
                surplusMax = surplus[i];
                sellIndex = i;
            }
            if (deficit[i] > deficitMax) {
                deficitMax = deficit[i];
                buyIndex = i;
            }
        }

        // Determine if the trade is large enough to be worth doing and calculate amounts.
        {
            uint256 minAuctionSizeInBUs = _toBUs((main.rToken().totalSupply() * _config.minAuctionSize) / SCALE);
            uint256 minAuctionSizeInFiatcoins = (minAuctionSizeInBUs * vault.basketFiatcoinRate()) / SCALE;
            shouldTrade = deficitMax > minAuctionSizeInFiatcoins && surplusMax > minAuctionSizeInFiatcoins;
            minBuyAmount = (deficitMax * SCALE) / prices[buyIndex];
            sell = IAsset(_allAssets.at(sellIndex));
            buy = IAsset(_allAssets.at(buyIndex));
        }

        uint256 maxSell = ((deficitMax * SCALE) / (SCALE - _config.maxTradeSlippage));
        sellAmount = (Math.min(maxSell, surplusMax) * SCALE) / sell.redemptionRate();
        return (shouldTrade, sell, buy, sellAmount, minBuyAmount);
    }
}
