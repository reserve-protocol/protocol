// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/main/BasketHandler.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/BackingTrader.sol";
import "contracts/p0/RevenueTrader.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";
import "./AssetRegistry.sol";
import "./SettingsHandler.sol";
import "./BasketHandler.sol";

/**
 * @title Auctioneer
 * @notice Handles auctions.
 */
contract AuctioneerP0 is
    Pausable,
    Mixin,
    AssetRegistryP0,
    SettingsHandlerP0,
    BasketHandlerP0,
    IAuctioneer
{
    using BasketLib for Basket;
    using FixLib for Fix;
    using SafeERC20 for IERC20Metadata;

    BackingTraderP0 public backingTrader;
    RevenueTraderP0 public rsrTrader;
    RevenueTraderP0 public rTokenTrader;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, AssetRegistryP0, SettingsHandlerP0, BasketHandlerP0)
    {
        super.init(args);
        backingTrader = new BackingTraderP0(IMain(address(this)));
        rsrTrader = new RevenueTraderP0(IMain(address(this)), rsrAsset());
        rTokenTrader = new RevenueTraderP0(IMain(address(this)), rTokenAsset());
    }

    function poke() public virtual override(Mixin, BasketHandlerP0) notPaused {
        super.poke();

        // Backing Trader
        backingTrader.poke();

        if (!backingTrader.hasOpenAuctions() && !fullyCapitalized()) {
            /* If we're here, then we need to run more auctions to capitalize the current vault. The
               BackingTrader will run those auctions, but it needs to be given BUs from old vaults,
               and told how many BUs for the current vault to raise. Given a BU amount, it'll try to
               raise that number of BUs, and it will redeem away staked RSR if necessary in order to
               do those raises.

               If the current vault is well under-capitalized, then we don't want to run all of
               those auctions at once, because if tie up all the collateral in auction, then RToken
               holders won't be able to redeem from the protocol. So, we raise at most
               (migrationChunk * rToken supply) BUs at a time
            */

            Fix maxBUs = migrationChunk().mul(toBUs(rToken().totalSupply()));
            Fix redeemedBUs = _redeemBUs(address(this), address(backingTrader), maxBUs);
            Fix buShortfall = toBUs(rToken().totalSupply()).minus(basketUnits[address(rToken())]);
            require(buShortfall.gte(FIX_ZERO), "buShortfall negative");

            if (redeemedBUs.gt(FIX_ZERO)) {
                backingTrader.increaseBUTarget(redeemedBUs, buShortfall);
                backingTrader.poke();
            }

            if (!backingTrader.hasOpenAuctions() && !fullyCapitalized()) {
                /* If we're *here*, then we're out of capital we can trade for RToken backing,
                 * including staked RSR. There's only one option left to us... */
                _diluteRTokenHolders();
            }
        }

        // RSR Trader
        rsrTrader.poke();

        // RToken Trader
        rTokenTrader.poke();
    }

    function backingTraderAddr() external view override returns (address) {
        return address(backingTrader);
    }

    function rsrTraderAddr() external view override returns (address) {
        return address(rsrTrader);
    }

    function rTokenTraderAddr() external view override returns (address) {
        return address(rTokenTrader);
    }

    /// Mint RToken and send to BackingTrader in order to recapitalize.
    function _diluteRTokenHolders() internal {
        Fix heldBUs = _basket.maxIssuableBUs(address(this)); // {BU}
        Fix missingBUs = basketUnits[address(rToken())].minus(heldBUs); // {BU}
        assert(missingBUs.gt(FIX_ZERO));

        // {none} = ({BU} + {BU}) / {BU}
        Fix dilution = missingBUs.plus(heldBUs).div(heldBUs);

        // {qRTok} = {qRTok} * {none}
        uint256 toMint = dilution.mulu(rToken().totalSupply()).ceil();
        rToken().mint(address(backingTrader), toMint);
    }
}
