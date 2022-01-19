// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
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
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;
    using SafeERC20 for IERC20;

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

        // TODO: Move logic into BackingTrader by making BackingTrader able to access Main's BUs
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
                // TODO
                // _rTokenHaircut();
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
}
