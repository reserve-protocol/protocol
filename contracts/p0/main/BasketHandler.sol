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
    Fix weight;
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
    using SafeERC20 for IERC20Metadata;
    using FixLib for Fix;

    // Basket templates:
    // - a basket template is a collection of template elements, whose weights should add up to 1.
    // - the order of the templates array is not guaranteed; deletion may occur via "swap-and-pop"
    Template[] public templates;

    /// The highest-scoring collateral for each role; used *only* in _setNextBasket.
    mapping(bytes32 => ICollateral) private collFor;
    /// The highest collateral score to fill each role; used *only* in _setNextBasket.
    mapping(bytes32 => Fix) private score;

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
        _updateCollateralStatuses();
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
        return _actualBUHoldings().gte(_BUTarget());
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

    function _updateCollateralStatuses() internal {
        for (uint256 i = 0; i < _assets.length(); i++) {
            if (IAsset(_assets.at(i)).isCollateral()) {
                ICollateral(_assets.at(i)).forceUpdates();
            }
        }
    }

    function _updateBasket() internal {
        if (_worstCollateralStatus() == CollateralStatus.DISABLED) {
            _setNextBasket();
        }
    }

    /// @return {BU} The BU target to be considered capitalized
    // solhint-disable-next-line func-name-mixedcase
    function _BUTarget() internal view returns (Fix) {
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

    /// @return status The maximum CollateralStatus among basket collateral
    function _worstCollateralStatus() internal view returns (CollateralStatus status) {
        for (uint256 i = 0; i < _basket.size; i++) {
            if (!_assets.contains(address(_basket.collateral[i]))) {
                return CollateralStatus.DISABLED;
            }
            if (uint256(_basket.collateral[i].status()) > uint256(status)) {
                status = _basket.collateral[i].status();
            }
        }
    }

    /// Select and set the next basket
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
        for (uint256 i = 0; i < _basket.size; i++) {
            _basket.amounts[_basket.collateral[i]] = FIX_ZERO;
            delete _basket.collateral[i];
        }

        // Set the new _basket
        Template storage template = templates[bestTemplateIndex];
        _basket.size = template.slots.length;
        _blockBasketLastUpdated = block.number;
        for (uint256 i = 0; i < _basket.size; i++) {
            ICollateral coll = collFor[template.slots[i].role];
            _basket.collateral[i] = coll;
            _basket.amounts[coll] = template.slots[i].weight.mul(coll.roleCoefficient());
        }
    }
}
