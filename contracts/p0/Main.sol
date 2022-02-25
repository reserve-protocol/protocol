// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/main/AssetRegistry.sol";
import "contracts/p0/main/SettingsHandler.sol";
import "contracts/p0/main/RewardClaimer.sol";
import "contracts/p0/main/RTokenIssuer.sol";
import "contracts/p0/main/Auctioneer.sol";
import "contracts/p0/main/BasketHandler.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/Component.sol";
import "contracts/Pausable.sol";

/**
 * @title Main
 * @notice Collects all mixins.
 */
contract MainP0 is
    Component,
    Ownable,
    Pausable,
    SettingsHandlerP0,
    RevenueDistributorP0,
    AssetRegistryP0,
    BasketHandlerP0,
    AuctioneerP0,
    RewardClaimerP0,
    RTokenIssuerP0,
    IMain
{
    using FixLib for Fix;

    /// Constructor-as-function
    /// Idempotent
    function init(ConstructorArgs calldata args)
        public
        virtual
        override(
            Component,
            SettingsHandlerP0,
            RevenueDistributorP0,
            AssetRegistryP0,
            BasketHandlerP0,
            AuctioneerP0,
            RewardClaimerP0,
            RTokenIssuerP0,
            IMain
        )
        onlyOwner
    {
        super.init(args);
    }
}
