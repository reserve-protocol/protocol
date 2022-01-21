// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/p0/interfaces/IOracle.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/libraries/Basket.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/main/RevenueDistributor.sol";
import "contracts/libraries/CommonErrors.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";
import "./SettingsHandler.sol";

struct TemplateElmt {
    bytes32 role;
    Fix[] weights; // The intended weight for the [best, 2nd best, 3rd best, ...] elements of role
}

struct Template {
    Fix govScore;
    TemplateElmt[] slots;
}

/**
 * @title BasketHandler
 * @notice Tries to ensure the current vault is valid at all times.
 */
contract BasketHandlerP0 is
    Pausable,
    Mixin,
    SettingsHandlerP0,
    RevenueDistributorP0,
    IBasketHandler
{
    using BasketLib for Basket;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using SafeERC20 for IERC20Metadata;
    using FixLib for Fix;

    // Basket templates:
    // - a basket template is a collection of template elements, whose weights should add up to 1.
    // - the order of the templates array is not guaranteed; deletion may occur via "swap-and-pop"
    Template[] public templates;

    Basket internal _basket;
    uint256 internal _blockBasketLastUpdated; // {block number} last set

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, SettingsHandlerP0, RevenueDistributorP0)
    {
        super.init(args);
    }

    function poke() public virtual override notPaused {
        super.poke();
        _updateBasket();
    }

    function setBasket(ICollateral[] calldata collateral, Fix[] calldata amounts)
        public
        override
        onlyOwner
    {
        require(collateral.length == amounts.length, "must be same lengths");
        for (uint256 i = 0; i < collateral.length; i++) {
            _basket.collateral[i] = collateral[i];
            _basket.amounts[collateral[i]] = amounts[i];
        }
        _basket.size = collateral.length;
        _blockBasketLastUpdated = block.number;
    }

    // Govern set of templates
    /// Add the new basket template `template`
    function addBasketTemplate(Template memory template) public onlyOwner {
        /// @dev A manual copy necessary here because moving from memory to storage.
        _copyTemplateToStorage(template, templates.push());
    }

    /// Replace the template at `index` with `template`.
    function setBasketTemplate(uint256 index, Template memory template) public onlyOwner {
        _copyTemplateToStorage(template, templates[index]);
    }

    /// Delete the template at `index`
    function deleteBasketTemplate(uint256 index) public onlyOwner {
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

    /// @return attoUSD {attoUSD/BU} The price of a whole BU in attoUSD
    function basketPrice() external view override returns (Fix attoUSD) {
        return _basket.price();
    }

    /// @return Whether it holds enough basket units of collateral
    function fullyCapitalized() public view override returns (bool) {
        return _actualBUHoldings().gte(_targetBUs());
    }

    /// @return status The maximum CollateralStatus among basket collateral
    function worstCollateralStatus() public view override returns (CollateralStatus status) {
        for (uint256 i = 0; i < _basket.size; i++) {
            if (!_assets.contains(address(_basket.collateral[i]))) {
                return CollateralStatus.DISABLED;
            }
            if (uint256(_basket.collateral[i].status()) > uint256(status)) {
                status = _basket.collateral[i].status();
            }
        }
    }

    /// @return {BU/rTok}
    function baseFactor() public view override returns (Fix) {
        Fix supply = toFix(rToken().totalSupply()); // {qRTok}
        Fix melted = toFix(rToken().totalMelted()); // {qRTok}
        return supply.eq(FIX_ZERO) ? FIX_ONE : supply.plus(melted).div(supply);
    }

    /// @return amounts {attoRef/BU} The amounts of collateral required per BU
    function basketReferenceAmounts() external view override returns (Fix[] memory amounts) {
        amounts = new Fix[](_basket.size);
        for (uint256 i = 0; i < _basket.size; i++) {
            amounts[i] = _basket.amounts[_basket.collateral[i]];
        }
    }

    // ==== Internal ====

    function _updateBasket() internal {
        for (uint256 i = 0; i < _assets.length(); i++) {
            if (IAsset(_assets.at(i)).isCollateral()) {
                ICollateral(_assets.at(i)).forceUpdates();
            }
        }
        if (worstCollateralStatus() == CollateralStatus.DISABLED) {
            _setNextBasket();
        }
    }

    /// @return {BU} The BU target to be considered capitalized
    function _targetBUs() internal view returns (Fix) {
        return _toBUs(rToken().totalSupply());
    }

    /// @return {BU} The equivalent of the current holdings in BUs without considering trading
    function _actualBUHoldings() internal view returns (Fix) {
        return _basket.maxIssuableBUs(address(this));
    }

    /// {qRTok} -> {BU}
    function _toBUs(uint256 amount) internal view returns (Fix) {
        // {BU} = {BU/rTok} * {qRTok} / {qRTok/rTok}
        return baseFactor().mulu(amount).shiftLeft(-int8(rToken().decimals()));
    }

    /// {BU} -> {qRTok}
    function _fromBUs(Fix amtBUs) internal view returns (uint256) {
        // {qRTok} = {BU} / {BU/rTok} * {qRTok/rTok}
        return amtBUs.div(baseFactor()).shiftLeft(int8(rToken().decimals())).floor();
    }

    /* /// The highest-scoring collateral for each role; used *only* in _setNextBasket. */
    /* mapping(bytes32 => ICollateral) private collFor; */
    /* /// The highest collateral score to fill each role; used *only* in _setNextBasket. */
    /* mapping(bytes32 => Fix) private score; */

    struct ScoredColl {
        Fix score;
        ICollateral coll;
    }

    // Helper data structures for _setNextBasket. Should be zeroed out by the end of each txn!
    // For P3: This is probably *costly* with in-storage data structures. Can we do better?
    // (one way to do better is for each scores array to be an in-place maxheap)
    // @dev Y NO MEMMAPS SOLIDITY Y
    EnumerableSet.Bytes32Set private roles;
    mapping(bytes32 => ScoredColl[]) private scores;
    mapping(bytes32 => ScoredColl[]) private topScores;
    mapping(ICollateral => uint256) private basketIndicesPlusOne;

    /// In the context of _setNextBasket, get the kth highest-scoring Collateral for the given role.
    /// Sorts scores into topScores as needed.
    /// @return the kth highest-scoring Collateral
    function _kthBest(bytes32 role, uint256 k) private returns (ScoredColl memory) {
        // If no collateral fills role, then return a zero-value ScoredColl
        if (scores[role].length == 0) {
            return ScoredColl(FIX_ZERO, ICollateral(address(0)));
        }
        // If k > the number N of collaterals that fill role, then "wrap around"
        k %= scores[role].length;

        // Ensure that topScores[role] holds the k highest-scoring Collaterals, in decreasing order.
        for (uint256 n = topScores[role].length; n <= k; n++) {
            // find the best-scoring remaining Collateral in scores[role], add it to topScores.
            // (this is basically a prefix of selection sort, which I claim is *right* here)
            uint256 bestIndex;
            Fix bestScore = FIX_MIN;
            for (uint256 i = 0; i < scores[role].length; i++) {
                if (scores[role][i].score.gt(bestScore)) {
                    bestIndex = i;
                    bestScore = scores[role][i].score;
                }
            }
            // remove the best-scoring Collateral from scores (swap+pop) and add it to topScores
            topScores[role].push(scores[role][bestIndex]);
            if (bestIndex < scores[role].length - 1) {
                scores[role][bestIndex] = scores[role][scores[role].length - 1];
            }
            scores[role].pop();
        }

        return topScores[role][k];
    }

    /// Select and set the next basket
    function _setNextBasket() private {
        // Collect roles and collateral scores per role
        for (uint256 i = 0; i < _assets.length(); i++) {
            IAsset asset = IAsset(_assets.at(i));
            if (!asset.isCollateral()) continue;

            ICollateral coll = ICollateral(address(asset));
            Fix score = coll.score();
            bytes32 role = coll.role();

            roles.add(role);
            scores[role].push(ScoredColl(score, coll));
        }

        // Find the highest-scoring template
        uint256 bestTemplateIdx;
        if (templates.length <= 1) {
            bestTemplateIdx = 0;
        } else {
            Fix bestScore;
            for (uint256 tmplIdx = 0; tmplIdx < templates.length; tmplIdx++) {
                // compute each template's score:
                //     sum (weight * (collateral score)) for each weight, in each template slot
                Fix tmplScore = FIX_ZERO;
                TemplateElmt[] storage slots = templates[tmplIdx].slots;
                for (uint256 slotIdx = 0; slotIdx < slots.length; slotIdx++) {
                    TemplateElmt storage slot = slots[slotIdx];
                    for (uint256 wtIdx = 0; wtIdx < slot.weights.length; wtIdx++) {
                        Fix weight = slot.weights[wtIdx];
                        Fix collScore = _kthBest(slot.role, wtIdx).score;
                        tmplScore = tmplScore.plus(weight.mul(collScore));
                    }
                }

                // ... times the template's own gov score.
                tmplScore = tmplScore.mul(templates[tmplIdx].govScore);

                if (tmplScore.gt(bestScore)) {
                    bestScore = tmplScore;
                    bestTemplateIdx = tmplIdx;
                }
            }
        }

        // Clear the old basket
        for (uint256 i = 0; i < _basket.size; i++) {
            _basket.amounts[_basket.collateral[i]] = FIX_ZERO;
            delete _basket.collateral[i];
        }

        // Set the new _basket
        Template storage template = templates[bestTemplateIdx];
        uint256 basketSize = 0;

        for (uint256 slotIdx = 0; slotIdx < template.slots.length; slotIdx++) {
            TemplateElmt storage slot = template.slots[slotIdx];
            for (uint256 wtIdx = 0; wtIdx < slot.weights.length; wtIdx++) {
                ICollateral coll = _kthBest(slot.role, wtIdx).coll;
                uint256 loc = basketIndicesPlusOne[coll];
                if (loc == 0) {
                    // Add coll to basket if not already present.
                    _basket.collateral[basketSize] = coll;
                    basketSize++;
                }
                // Add this template weight to the basket (whether or not coll was already present)
                _basket.amounts[coll] = _basket.amounts[coll].plus(
                    slot.weights[wtIdx].mul(coll.roleCoefficient())
                );
            }
        }
        _basket.size = basketSize;

        // Finally, zero out the local, in-storage data structures
        for (uint256 i = 0; i < roles.length(); i++) {
            bytes32 role = roles.at(i);
            delete scores[role];
            delete topScores[role];
            roles.remove(role);
        }
    }
}
