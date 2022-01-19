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

    // {BU}
    mapping(address => Fix) public basketUnits;
    Fix private _totalBUs;

    Basket internal _basket;

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
        _tryEnsureValidBasket();
    }

    function setBasket(ICollateral[] calldata collateral, Fix[] calldata amounts)
        external
        override
        onlyOwner
    {
        _basket.set(collateral, amounts);
    }

    /// Anyone can create BUs for the BasketHandler if they would like to!
    function donateBUs(Fix amtBUs) external override {
        _issueBUs(_msgSender(), address(rToken()), amtBUs);
    }

    /// @return attoUSD {attoUSD/BU} The price of a whole BU in attoUSD
    function basketPrice() external view override returns (Fix attoUSD) {
        return _basket.price();
    }

    /// @return Whether the vault is fully capitalized or not
    function fullyCapitalized() public view override returns (bool) {
        Fix amtBUs = basketUnits[address(rToken())];
        for (uint256 i = 0; i < _basket.size; i++) {
            uint256 found = _basket.collateral[i].erc20().balanceOf(address(this));
            // {qTok} = {qTok/BU} * {BU}
            uint256 required = _basket.quantity(_basket.collateral[i]).mul(amtBUs).ceil();
            if (found < required) {
                return false;
            }
        }
        return true;
    }

    /// {qRTok} -> {BU}
    function toBUs(uint256 amount) public view override returns (Fix) {
        // {BU} = {BU/rTok} * {qRTok} / {qRTok/rTok}
        return baseFactor().mulu(amount).shiftLeft(-int8(rToken().decimals()));
    }

    /// {BU} -> {qRTok}
    function fromBUs(Fix amtBUs) public view override returns (uint256) {
        // {qRTok} = {BU} / {BU/rTok} * {qRTok/rTok}
        return amtBUs.div(baseFactor()).shiftLeft(int8(rToken().decimals())).floor();
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

    /// @return {qTok} The basket collateral quantities corresponding to an amount of BUs
    function basketCollateralQuantities(Fix amtBUs)
        external
        view
        override
        returns (uint256[] memory)
    {
        return _basket.toCollateralQuantities(amtBUs, RoundingApproach.CEIL);
    }

    /// @return The max BUs the account can issue
    function maxIssuableBUs(address account) external view override returns (Fix) {
        // TODO There's inelegance here -- both this function and `donateBUs` above smell weird
        return _basket.maxIssuableBUs(account);
    }

    // ==== Internal ====

    function _updateCollateralStatuses() internal {
        for (uint256 i = 0; i < _assets.length(); i++) {
            if (IAsset(_assets.at(i)).isCollateral()) {
                ICollateral(_assets.at(i)).forceUpdates();
            }
        }
    }

    function _tryEnsureValidBasket() internal {
        if (_worstCollateralStatus() == CollateralStatus.DISABLED) {
            // TODO
            bool hasNext = _selectNextVault();
            if (hasNext) {
                // TODO
                // _switchVault(nextVault);
                _basket.set(new ICollateral[](0), new Fix[](0));
            }
        }
    }

    /// @param from The address funding the BU purchase with collateral tokens
    /// @param to The address being credited the BUs
    function _issueBUs(
        address from,
        address to,
        Fix amtBUs
    ) internal {
        uint256[] memory amounts = _basket.toCollateralQuantities(amtBUs, RoundingApproach.CEIL);
        for (uint256 i = 0; i < amounts.length; i++) {
            _basket.collateral[i].erc20().safeTransferFrom(from, to, amounts[i]);
        }
        basketUnits[to] = basketUnits[to].plus(amtBUs);
        _totalBUs = _totalBUs.plus(amtBUs);
    }

    /// @param from The address holding the BUs to redeem
    /// @param to The address to receive the collateral tokens
    function _redeemBUs(
        address from,
        address to,
        Fix amtBUs
    ) internal returns (Fix) {
        amtBUs = fixMin(amtBUs, basketUnits[from]);
        uint256[] memory amounts = _basket.toCollateralQuantities(amtBUs, RoundingApproach.FLOOR);
        for (uint256 i = 0; i < amounts.length; i++) {
            _basket.collateral[i].erc20().safeTransfer(to, amounts[i]);
        }
        basketUnits[from] = basketUnits[from].minus(amtBUs);
        require(basketUnits[from].gte(FIX_ZERO), "not enough basket units");
        _totalBUs = _totalBUs.minus(amtBUs);
        require(_totalBUs.gte(FIX_ZERO), "_totalBUs underflow");
        return amtBUs;
    }

    function _transferBUs(
        address from,
        address to,
        Fix amtBUs
    ) internal {
        basketUnits[from] = basketUnits[from].minus(amtBUs);
        require(basketUnits[from].gte(FIX_ZERO), "not enough basket units");
        basketUnits[to] = basketUnits[to].plus(amtBUs);
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

    /// @return A vault from the list of backup vaults that is not defaulting
    function _selectNextVault() internal view returns (bool) {
        // TODO where matt hooks in
        return true;
    }
}
