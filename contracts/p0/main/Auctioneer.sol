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

    Auction[] public auctions;

    BackingTraderP0 public backingTrader;
    RevenueTraderP0 public rsrStakingTrader;
    RevenueTraderP0 public rTokenMeltingTrader;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, AssetRegistryP0, SettingsHandlerP0, VaultHandlerP0)
    {
        super.init(args);
        backingTrader = new BackingTraderP0(IMain(address(this)));
        rsrStakingTrader = new RevenueTraderP0(IMain(address(this)), rsrAsset());
        rTokenMeltingTrader = new RevenueTraderP0(IMain(address(this)), rTokenAsset());
    }

    function poke() public virtual override notPaused {
        super.poke();

        // Backing Trader
        backingTrader.poke();
        if (!backingTrader.hasOpenAuctions() && !fullyCapitalized()) {
            uint256 maxBUs = toBUs(migrationChunk().mulu(rToken().totalSupply()).toRoundUint());
            uint256 crackedBUs = _crackOldVaults(address(backingTrader), maxBUs);
            uint256 buShortfall = toBUs(rToken().totalSupply()) -
                vault().basketUnits(address(this));

            if (crackedBUs > 0) {
                backingTrader.increaseBUTarget(crackedBUs, buShortfall);
                backingTrader.poke();
            }

            if (!backingTrader.hasOpenAuctions() && !fullyCapitalized()) {
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
        rsrStakingTrader.poke();

        // RToken Trader
        rTokenMeltingTrader.poke();
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
