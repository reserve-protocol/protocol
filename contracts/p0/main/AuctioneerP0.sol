// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/libraries/Auction.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/interfaces/IVault.sol";
import "contracts/p0/main/VaultHandlerP0.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/BackingTrader.sol";
import "contracts/p0/RevenueTrader.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";
import "./AssetRegistryP0.sol";
import "./MoodyP0.sol";
import "./SettingsHandlerP0.sol";
import "./VaultHandlerP0.sol";

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
    using Auction for Auction.Info;
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for Fix;
    using SafeERC20 for IERC20;

    Auction.Info[] public auctions;

    BackingTrader public override backingTrader;
    RevenueTrader public rsrTrader;
    RevenueTrader public rTokenTrader;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, AssetRegistryP0, SettingsHandlerP0, VaultHandlerP0)
    {
        super.init(args);
        backingTrader = new BackingTrader(this);
        rsrTrader = new RevenueTrader(this, Fate.STAKE);
        rTokenTrader = new RevenueTrader(this, Fate.MELT);
    }

    function poke() public virtual override notPaused {
        super.poke();
        bool trading = backingTrader.poke();
        if (!trading && !fullyCapitalized()) {
            uint256 maxBUs = toBUs(migrationChunk().mulu(rToken().totalSupply()).toUint());
            uint256 crackedBUs = _crackOldVaults(address(backingTrader), maxBUs);
            if (crackedBUs > 0) {
                // TODO: There may be excess BUs between rounds, and after all rounds
                backingTrader.addToBUTarget(crackedBUs);
                trading = backingTrader.poke();
            }

            if (!trading && !fullyCapitalized()) {
                _rTokenHaircut();
            }
        }

        // TODO: REVENUE TRADERS
    }

    function _rTokenHaircut() private {
        // The ultimate endgame: a haircut for RToken holders.
        _accumulate();
        _historicalBasketDilution = _meltingFactor().mulu(rToken().totalSupply()).divu(
            vault.basketUnits(address(this))
        );
        _setMood(Mood.CALM);
    }
}
