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
    DefaultHandlerP0,
    AuctioneerP0,
    RevenueHandlerP0,
    RTokenIssuerP0,
    IMain
{
    using FixLib for Fix;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(
            IMixin,
            Mixin,
            AssetRegistryP0,
            SettingsHandlerP0,
            DefaultHandlerP0,
            AuctioneerP0,
            RevenueHandlerP0,
            RTokenIssuerP0
        )
    {
        super.init(args);
    }

    function poke()
        public
        virtual
        override(IMixin, Mixin, DefaultHandlerP0, AuctioneerP0, RevenueHandlerP0, RTokenIssuerP0)
    {
        super.poke();
    }

    function setConfig(Config memory config_) public virtual override(ISettingsHandler, SettingsHandlerP0) onlyOwner {
        // TODO: (Taylor) I think we shouldn't do the closed form basket dilution...I think we should
        // accumulate every block into a cumulative measure. This also solves the problem of
        // the actual supply of the token mattering at the moment of accumulation. The closed
        // form version of things implicitly assumes a non-zero supply, so would incorrectly
        // dilute the basket even when no profits are earned (because there was no backing to appreciate).

        // Hence, putting this at the top-level for now because it should go away.

        // When f changes we need to accumulate the historical basket dilution
        if (_config.f.neq(config_.f)) {
            _accumulate();
        }
        SettingsHandlerP0.setConfig(config_);
    }
}

// import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
// import "@openzeppelin/contracts/access/Ownable.sol";
// import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
// import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
// import "contracts/p0/assets/collateral/ATokenCollateralP0.sol";
// import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// import "@openzeppelin/contracts/utils/math/Math.sol";
// import "contracts/p0/libraries/Auction.sol";
// import "contracts/p0/assets/RTokenAssetP0.sol";
// import "contracts/p0/assets/RSRAssetP0.sol";
// import "contracts/p0/assets/AAVEAssetP0.sol";
// import "contracts/p0/assets/COMPAssetP0.sol";
// import "contracts/p0/libraries/Oracle.sol";
// import "contracts/p0/interfaces/IAsset.sol";
// import "contracts/p0/interfaces/IAssetManager.sol";
// import "contracts/p0/interfaces/IDefaultMonitor.sol";
// import "contracts/p0/interfaces/IFurnace.sol";
// import "contracts/p0/interfaces/IMain.sol";
// import "contracts/p0/interfaces/IRToken.sol";
// import "contracts/p0/interfaces/IVault.sol";
// import "contracts/libraries/Fixed.sol";
// import "contracts/Pausable.sol";
// import "contracts/p0/FurnaceP0.sol";
// import "contracts/p0/RTokenP0.sol";
// import "contracts/p0/StRSRP0.sol";
// import "contracts/libraries/CommonErrors.sol";

// /**
//  * @title MainP0
//  * @notice The central coordinator for the entire system, as well as the external interface.
//  */

// // solhint-disable max-states-count
// contract MainP0 is IMain, Pausable {
//     using Auction for Auction.Info;
//     using EnumerableSet for EnumerableSet.AddressSet;
//     using FixLib for Fix;
//     using Oracle for Oracle.Info;
//     using SafeERC20 for IERC20;

//     IMarket public market;

//     //

//     constructor(
//         Oracle.Info memory oracle_,
//         Config memory config_,
//         IVault vault_,
//         IMarket market_,
//         ICollateral[] memory approvedCollateral_
//     ) {
//         _oracle = oracle_;
//         _config = config_;
//         f = config_.f; // TODO
//         vault = vault_;
//         market = market_;

//         for (uint256 i = 0; i < approvedCollateral_.length; i++) {
//             _approveCollateral(approvedCollateral_[i]);
//         }

//         ICollateral[] memory c = new ICollateral[](_approvedCollateral.length());
//         for (uint256 i = 0; i < c.length; i++) {
//             c[i] = ICollateral(_approvedCollateral.at(i));
//         }
//         if (!vault.containsOnly(c)) {
//             revert CommonErrors.UnapprovedCollateral();
//         }

//         rsrAsset.erc20().approve(address(stRSR), type(uint256).max);
//         _prevBasketRate = vault.basketRate();
//         _historicalBasketDilution = FIX_ONE;
//     }

//     /// This modifier runs before every function including redemption, so it should be very safe.
//     modifier always() {
//         furnace.doBurn();
//         // TODO: Update compound?
//         ICollateral[] memory hardDefaulting = monitor.checkForHardDefault(vault);
//         if (hardDefaulting.length > 0) {
//             _switchVault(hardDefaulting);
//             mood = Mood.TRADING; // TODO
//         }
//         _;
//     }

//     /// Runs the central auction loop
//     function poke() external virtual override notPaused always {
//         require(mood == Mood.CALM || mood == Mood.TRADING, "only during calm + trading");
//         _processSlowIssuance();

//         if (mood == Mood.CALM) {
//             (uint256 prevRewards, ) = _rewardsAdjacent(block.timestamp);
//             if (!rewardsClaimed[prevRewards]) {
//                 collectRevenue();
//                 rewardsClaimed[prevRewards] = true;
//             }
//         }

//         doAuctions();
//     }

//     /// Performs any and all auctions in the system

//     // ==================================== Views ====================================

//     /// @return The RToken deployment
//     function rToken() public view override returns (IRToken) {
//         return IRToken(address(rTokenAsset.erc20()));
//     }

//     /// @return The RSR deployment
//     function rsr() public view override returns (IERC20) {
//         return rsrAsset.erc20();
//     }

//     //TODO: Delete
//     function config() external view override returns (Config memory) {
//         return _config;
//     }

//     // ==================================== Internal ====================================
//     // TODO: Remove

//     function defaultThreshold() external view override returns (Fix) {
//         return _config.defaultThreshold;
//     }

//     function stRSRWithdrawalDelay() external view override returns (uint256) {
//         return _config.stRSRWithdrawalDelay;
//     }

//     //
