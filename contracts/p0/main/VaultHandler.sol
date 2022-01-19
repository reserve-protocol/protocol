// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/p0/interfaces/IOracle.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IVault.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/main/RevenueDistributor.sol";
import "contracts/libraries/CommonErrors.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";
import "./SettingsHandler.sol";

struct TemplateElmt {
    bytes32 role;
    Fix weight;
}
struct Template {
    Fix govScore;
    TemplateElmt[] slots;
}

/**
 * @title VaultHandler
 * @notice Handles the use of vaults and their associated basket units (BUs), including the tracking
 *    of the base rate, the exchange rate between RToken and BUs.
 */

contract VaultHandlerP0 is Pausable, Mixin, SettingsHandlerP0, RevenueDistributorP0, IVaultHandler {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;
    using FixLib for Fix;
    // ECONOMICS
    //
    // base factor = exchange rate between Vault BUs and RTokens
    // base factor = b = _meltingFactor() / _basketDilutionFactor()
    // <RToken> = b * <Basket Unit Vector>
    // Fully capitalized: #RTokens <= #BUs / b

    Fix internal _historicalBasketDilution; // the product of all historical basket dilutions
    Fix internal _prevBasketPrice; // {USD/qBU} redemption value of the basket at last update

    Basket public basket;

    // basket templates:
    // - a basket template is a collection of template elements, whose weights should add up to 1.
    // - the order of the templates array is not guaranteed; deletion may occur via "swap-and-pop"
    Template[] public templates;

    // TODO: eliminate vaults; use only basket.
    IVault[] public override vaults;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, SettingsHandlerP0, RevenueDistributorP0)
    {
        super.init(args);

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

    /// Add the new basket template `template`
    function addBasketTemplate(Template memory template) public {
        /// @dev A manual copy necessary here because moving from memory to storage.
        _copyTemplateToStorage(template, templates.push());
    }

    /// Replace the template at `index` with `template`.
    function setBasketTemplate(uint256 index, Template memory template) public {
        _copyTemplateToStorage(template, templates[index]);
    }

    /// Delete the template at `index`
    function deleteBasketTemplate(uint256 index) public {
        if (index < templates.length - 1) {
            templates[index] = templates[templates.length - 1];
        }
        templates.pop();
    }

    function _copyTemplateToStorage(Template memory memTmpl, Template storage storageTmpl) private {
        storageTmpl.govScore = memTmpl.govScore;
        delete storageTmpl.slots;
        for (uint256 i = 0; i < memTmpl.slots.length; i++) {
            storageTmpl.slots.push(memTmpl.slots[i]);
        }
    }

    /// The highest-scoring collateral for each role; used only in _setNextBasket.
    mapping(bytes32 => ICollateral) private collFor;
    /// The highest collateral score to fill each role; used only in _setNextBasket.
    mapping(bytes32 => Fix) private score;

    function _setNextBasket() private {
        // Find _score_ and _collFor_
        for (uint256 i = 0; i < _assets.length(); i++) {
            IAsset asset = IAsset(_assets.at(i));
            if (!asset.isCollateral()) continue;
            ICollateral coll = ICollateral(address(asset));

            Fix collScore = coll.score();
            bytes32 role = coll.role();
            if (collScore.gt(score[role])) {
                score[role] = collScore;
                collFor[role] = coll;
            }
        }

        // Find the highest-scoring template
        uint256 bestTemplateIndex;
        if (templates.length <= 1) {
            bestTemplateIndex = 0;
        } else {
            Fix bestScore;
            for (uint256 i = 0; i < templates.length; i++) {
                Fix tmplScore = FIX_ZERO;
                TemplateElmt[] storage slots = templates[i].slots;
                for (uint256 c = 0; c < slots.length; c++) {
                    tmplScore.plus(slots[c].weight.mul(score[slots[c].role]));
                }
                tmplScore = tmplScore.mul(templates[i].govScore);
                if (tmplScore.gt(bestScore)) {
                    bestScore = tmplScore;
                    bestTemplateIndex = i;
                }
            }
        }

        // Clear the old basket
        for (uint256 i = 0; i < basket.size; i++) {
            basket.amounts[basket.collateral[i]] = FIX_ZERO;
            delete basket.collateral[i];
        }

        // Set the new basket
        Template storage template = templates[bestTemplateIndex];
        basket.size = template.slots.length;
        for (uint256 i = 0; i < basket.size; i++) {
            ICollateral coll = collFor[template.slots[i].role];
            basket.collateral[i] = coll;
            basket.amounts[coll] = template.slots[i].weight.mul(coll.roleCoefficient());
        }
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
        Fix currentPrice = vault().basketPrice();
        Fix prevPrice = _prevBasketPrice;

        // Assumption: Defi redemption rates are monotonically increasing
        // {USD/qBU}
        Fix delta = currentPrice.minus(prevPrice);
        // TODO: this should go away after we choose to accept the full Unit agnostic refactor

        // r = p2 / (p1 + (p2-p1) * (rTokenCut))
        Fix r = currentPrice.div(prevPrice.plus(delta.mul(rTokenCut())));
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
    /// @param allowCurrentVault Whether to redeem from the current vault in addition to old vaults.
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
            rToken().withdrawBUs(vault_, address(this), toRedeem);
            vault_.redeem(recipient, toRedeem);
        }
    }

    /// @return A vault from the list of backup vaults that is not defaulting
    function _selectNextVault() private view returns (bool, IVault) {
        Fix maxPrice;
        uint256 indexMax;
        IVault[] memory backups = vault().getBackups();

        // Find the highest-value backup that doesn't contain defaulting collateral
        for (uint256 i = 0; i < backups.length; i++) {
            if (backups[i].collateralStatus() == CollateralStatus.SOUND) {
                Fix price = backups[i].basketPrice(); // {attoUSD/BU}

                // See if it has the highest basket
                if (price.gt(maxPrice)) {
                    maxPrice = price;
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
