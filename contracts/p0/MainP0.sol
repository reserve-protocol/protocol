pragma solidity 0.8.9;
// SPDX-License-Identifier: BlueOak-1.0.0

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/main/SettingsHandlerP0.sol";
import "contracts/p0/main/MoodyP0.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/main/DefaultHandlerP0.sol";
import "contracts/p0/main/RevenueHandlerP0.sol";
import "contracts/p0/main/RTokenIssuerP0.sol";
import "contracts/p0/main/AuctioneerP0.sol";
import "contracts/p0/main/AssetRegistryP0.sol";
import "contracts/p0/main/VaultHandlerP0.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/Pausable.sol";

/**
 * @title Main
 * @notice Collects all mixins.
 */
contract MainP0 is
    Ownable,
    Mixin,
    AssetRegistryP0,
    SettingsHandlerP0,
    RevenueDistributorP0,
    VaultHandlerP0,
    DefaultHandlerP0,
    AuctioneerP0,
    RevenueHandlerP0,
    RTokenIssuerP0,
    IMain
{
    using FixLib for Fix;

    /// Constructor-as-function
    function init(ConstructorArgs calldata args)
        public
        virtual
        override(
            IMixin,
            Mixin,
            AssetRegistryP0,
            SettingsHandlerP0,
            RevenueDistributorP0,
            VaultHandlerP0,
            DefaultHandlerP0,
            AuctioneerP0,
            RevenueHandlerP0,
            RTokenIssuerP0
        )
    {
        super.init(args);
    }

    /// A central mutator that causes all mixins to act
    function poke()
        public
        virtual
        override(IMixin, Mixin, DefaultHandlerP0, AuctioneerP0, RevenueHandlerP0, RTokenIssuerP0)
    {
        super.poke();
    }

    /// An idempotent mutator for updating accounting metrics
    /// Unlike `poke`, no external side-effects
    function notify()
        public
        virtual
        override(
            IMixin,
            Mixin,
            AssetRegistryP0,
            SettingsHandlerP0,
            RevenueDistributorP0,
            VaultHandlerP0,
            DefaultHandlerP0,
            AuctioneerP0,
            RevenueHandlerP0,
            RTokenIssuerP0
        )
    {
        super.notify();
    }
}
