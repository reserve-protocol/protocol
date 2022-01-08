// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/p0/libraries/Pricing.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IVault.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/main/RevenueDistributor.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";
import "./SettingsHandler.sol";

/**
 * @title VaultHandler
 * @notice Handles the use of vaults and their associated basket units (BUs), including the tracking
 *    of the base rate, the exchange rate between RToken and BUs.
 */
contract VaultHandlerP0 is Pausable, Mixin, SettingsHandlerP0, RevenueDistributorP0, IVaultHandler {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;
    using FixLib for Fix;
    using PricingLib for Price;

    // ECONOMICS
    //
    // base factor = exchange rate between Vault BUs and RTokens
    // base factor = b = _meltingFactor() / _basketDilutionFactor()
    // <RToken> = b * <Basket Unit Vector>
    // Fully capitalized: #RTokens <= #BUs / b

    Fix internal _historicalBasketDilution; // the product of all historical basket dilutions
    Price internal _prevBasketPrice; // {USD/qBU} redemption value of the basket in fiatcoins last update

    IVault[] public override vaults;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, SettingsHandlerP0, RevenueDistributorP0)
    {
        super.init(args);
        vaults.push(args.vault);

        // Check vault collateral
        if (vault().collateralStatus() != CollateralStatus.SOUND) {
            revert CommonErrors.UnsoundVault();
        }

        _prevBasketPrice = args.vault.basketPrice();
        _historicalBasketDilution = FIX_ONE;
    }

    function poke() public virtual override notPaused {
        super.poke();
        _updateCollateralStatuses();
        _tryEnsureValidVault();
    }

    /// Fold current metrics into historical metrics
    function beforeUpdate() public virtual override {
        super.beforeUpdate();
        _historicalBasketDilution = _basketDilutionFactor();
        _prevBasketPrice = vault().basketPrice();
    }

    function switchVault(IVault vault_) external override onlyOwner {
        _switchVault(vault_);
    }

    function vault() public view override returns (IVault) {
        return vaults[vaults.length - 1];
    }

    function numVaults() external view override returns (uint256) {
        return vaults.length;
    }

    /// @return Whether the vault is fully capitalized
    function fullyCapitalized() public view override returns (bool) {
        uint256 amtBUs = vault().basketUnits(address(rToken())) +
            vault().basketUnits(address(this));
        return fromBUs(amtBUs) >= rToken().totalSupply();
    }

    /// {qRTok} -> {qBU}
    function toBUs(uint256 amount) public view override returns (uint256) {
        return baseFactor().mulu(amount).floor();
    }

    /// {qBU} -> {qRTok}
    function fromBUs(uint256 amtBUs) public view override returns (uint256) {
        return divFix(amtBUs, baseFactor()).floor();
    }

    /// @return {qRTok/qBU} The conversion rate from BUs to RTokens,
    /// 1.0 if the total rtoken supply is 0
    /// Else, (melting factor) / (basket dilution factor)
    function baseFactor() public view returns (Fix) {
        return
            rToken().totalSupply() == 0 ? FIX_ONE : _meltingFactor().div(_basketDilutionFactor());
    }

    // ==== Internal ====

    function _updateCollateralStatuses() internal {
        for (uint256 i = 0; i < _assets.length(); i++) {
            if (IAsset(_assets.at(i)).isCollateral()) {
                ICollateral(_assets.at(i)).forceUpdates();
            }
        }
    }

    function _tryEnsureValidVault() internal {
        if (vault().collateralStatus() == CollateralStatus.DISABLED) {
            (bool hasNext, IVault nextVault) = _selectNextVault();
            if (hasNext) {
                _switchVault(nextVault);
            }
        }
    }

    function _switchVault(IVault vault_) internal {
        beforeUpdate();
        emit NewVaultSet(address(vault()), address(vault_));
        vaults.push(vault_);
    }

    /* As the basketBalance increases, the basketDilutionFactor increases at a proportional rate.
     * for two times t0 < t1 when the rTokenCut() doesn't change, we have:
     * (basketDiluationFactor at t1) - (basketDilutionFactor at t0)
     * = rTokenCut() * ((basketPrice at t1) - (basketPrice at t0))
     */
    /// @return {qBU/qRTok) the basket dilution factor
    function _basketDilutionFactor() internal view returns (Fix) {
        // {USD/qBU}
        Price memory currentPrice = vault().basketPrice();
        Price memory prevPrice = _prevBasketPrice;

        // Assumption: Defi redemption rates are monotonically increasing
        // {USD/qBU}
        Fix delta = currentPrice.usd().minus(prevPrice.usd());
        // TODO: this should go away after we choose to accept the full UoA agnostic refactor

        // r = p2 / (p1 + (p2-p1) * (rTokenCut))
        Fix r = currentPrice.usd().div(prevPrice.usd().plus(delta.mul(rTokenCut())));
        Fix dilutionFactor = _historicalBasketDilution.mul(r);
        assert(dilutionFactor.neq(FIX_ZERO));
        return dilutionFactor;
    }

    /// @return {none} Numerator of the base factor
    function _meltingFactor() internal view returns (Fix) {
        Fix supply = toFix(rToken().totalSupply()); // {qRTok}
        Fix melted = toFix(rToken().totalMelted()); // {qRTok}
        return supply.eq(FIX_ZERO) ? FIX_ONE : supply.plus(melted).div(supply);
    }

    /// Redeems up to `maxBUs` basket units, redeeming from the oldest vault first.
    /// @param allowCurrentVault Whether to allow redemption from the current vault in addition to old vaults.
    /// @return redeemedBUs How many BUs were actually redeemed
    function _redeemFromOldVaults(
        address recipient,
        uint256 maxBUs,
        bool allowCurrentVault
    ) internal returns (uint256 redeemedBUs) {
        uint256 endIndex = allowCurrentVault ? vaults.length : vaults.length - 1;
        for (uint256 i = 0; i < endIndex && redeemedBUs < maxBUs; i++) {
            redeemedBUs += _redeemFrom(vaults[i], recipient, maxBUs - redeemedBUs);
        }
    }

    // ==== Private ====

    /// @dev You should probably never call this. Consider using _redeemFromOldVaults instead.
    /// @return toRedeem How many BUs were redeemed
    function _redeemFrom(
        IVault vault_,
        address recipient,
        uint256 maxToRedeem
    ) private returns (uint256 toRedeem) {
        toRedeem = Math.min(vault_.basketUnits(address(rToken())), maxToRedeem);
        if (toRedeem > 0) {
            rToken().withdrawBUs(address(this), toRedeem);
            vault_.redeem(recipient, toRedeem);
        }
    }

    /// @return A vault from the list of backup vaults that is not defaulting
    function _selectNextVault() private view returns (bool, IVault) {
        Fix maxPrice;
        uint256 indexMax;
        IVault[] memory backups = vault().getBackups();

        // Loop through backups to find the highest value one that doesn't contain defaulting collateral
        for (uint256 i = 0; i < backups.length; i++) {
            if (backups[i].collateralStatus() == CollateralStatus.SOUND) {
                Price memory price = backups[i].basketPrice(); // {attoPrice/BU}

                // See if it has the highest basket
                if (price.usd().gt(maxPrice)) {
                    maxPrice = price.usd();
                    indexMax = i;
                }
            }
        }

        if (maxPrice.eq(FIX_ZERO)) {
            return (false, IVault(address(0)));
        }
        return (true, backups[indexMax]);
    }
}
