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
import "contracts/p0/interfaces/IVault.sol";
import "contracts/p0/main/VaultHandler.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/BackingTrader.sol";
import "contracts/p0/RevenueTrader.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";
import "./AssetRegistry.sol";
import "./Moody.sol";
import "./SettingsHandler.sol";
import "./VaultHandler.sol";

/**
 * @title Auctioneer
 * @notice Handles auctions.
 */
contract AuctioneerP0 is
    Pausable,
    Mixin,
    MoodyP0,
    AssetRegistryP0,
    SettingsHandlerP0,
    VaultHandlerP0,
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
        override(Mixin, AssetRegistryP0, SettingsHandlerP0, VaultHandlerP0)
    {
        super.init(args);
        backingTrader = new BackingTraderP0(IMain(address(this)));
        rsrTrader = new RevenueTraderP0(IMain(address(this)), rsrAsset());
        rTokenTrader = new RevenueTraderP0(IMain(address(this)), rTokenAsset());
    }

    function poke() public virtual override notPaused {
        super.poke();

        // Backing Trader
        backingTrader.poke();
        if (!backingTrader.hasOpenAuctions() && !fullyCapitalized()) {
            /* If we're here, then we need to run more auctions to capitalize the current vault. The
               BackingTrader will run those auctions, but it needs to be given BUs from old vaults,
               and told how many BUs for the current vault to raise. Given a BU amount, it'll try to
               raise that number of BUs, and it will redeem away staked RSR if necessary in order to
               do those raises.

               If the current vault is well under-capitalized, then we don't want to run all of those
               auctions at once, because if tie up all the collateral in auction, then RToken holders
               won't be able to redeem from the protocol. So, we raise at most
               (migrationChunk * rToken supply) BUs at a time
            */

            uint256 maxBUs = toBUs(migrationChunk().mulu(rToken().totalSupply()).round());
            uint256 redeemedBUs = _redeemFromOldVaults(address(backingTrader), maxBUs, false);
            uint256 buShortfall = toBUs(rToken().totalSupply()) -
                vault().basketUnits(address(this));

            if (redeemedBUs > 0) {
                backingTrader.increaseBUTarget(redeemedBUs, buShortfall);
                backingTrader.poke();
            }

            if (!backingTrader.hasOpenAuctions() && !fullyCapitalized()) {
                /* If we're *here*, then we're out of capital we can trade for RToken backing,
                 * including staked RSR. There's only one option left to us... */
                _rTokenHaircut();
            }
            // TODO: There may be excess surplus and BUs after all rounds of trading. What should we
            // do with them?

            // Tentative answer: They should be turned into BUs and subsequently, RToken supply
            // expansion.  The concern would be this is an avenue for RSR holders to profit from
            // making the RToken basket worth less, but this is already a failure mode we have been
            // keeping in mind and are building governance to be resilient against.
        }

        // RSR Trader
        rsrTrader.poke();

        // RToken Trader
        rTokenTrader.poke();
    }

    function beforeUpdate()
        public
        virtual
        override(Mixin, AssetRegistryP0, SettingsHandlerP0, VaultHandlerP0)
    {
        super.beforeUpdate();
    }

    function getBackingTrader() external view override returns (address) {
        return address(backingTrader);
    }

    function _rTokenHaircut() private {
        // The ultimate endgame: a haircut for RToken holders.
        beforeUpdate();
        _historicalBasketDilution = _meltingFactor().mulu(rToken().totalSupply()).divu(
            vault().basketUnits(address(this))
        );
        _setMood(Mood.CALM);
    }
}
