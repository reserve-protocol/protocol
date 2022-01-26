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

struct BackupConfig {
    uint256 maxCollateral; // Maximum number of backup collateral elements to use in a basket
    ICollateral[] collateral; // Ordered list of backup collateral
}

struct BasketConfig {
    // The collateral in the prime (explicitly governance-set) basket
    ICollateral[] collateral;
    // Amount of target units per basket for each primt collateral. {target/BU}
    mapping(ICollateral => Fix) targetAmts;
    // Backup configurations, one per target name.
    mapping(bytes32 => BackupConfig) backups;
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

    BasketConfig private basketConf;
    Basket internal _basket; // TODO: no underscore
    uint256 internal _blockBasketLastUpdated; // {block number} last set  TODO: no underscore

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

    /// Set the prime basket in the basket configuration.
    /// @param collateral The collateral for the new prime basket
    /// @param targetAmts The target amounts (in) {target/BU} for the new prime basket
    /// @param selectBasket If true, immediately recompute the actual basket
    /// @return true if the actual basket might have been modified
    function setPrimeBasket(
        ICollateral[] memory collateral,
        Fix[] memory targetAmts,
        bool selectBasket
    ) public override onlyOwner returns (bool) {
        require(collateral.length == targetAmts.length, "must be same length");
        delete basketConf.collateral;
        for (uint256 i = 0; i < collateral.length; i++) {
            ICollateral c = collateral[i];
            basketConf.collateral.push(c);
            basketConf.targetAmts[c] = targetAmts[i];
        }
        if (selectBasket) return _selectBasket();
        else return false;
    }

    /// @return true if the actual basket might have been modified
    function setBackupConfig(
        bytes32 targetName,
        uint256 maxCollateral,
        ICollateral[] memory collateral,
        bool selectBasket
    ) public override onlyOwner returns (bool) {
        BackupConfig storage conf = basketConf.backups[targetName];
        conf.maxCollateral = maxCollateral;

        while (conf.collateral.length > collateral.length) {
            conf.collateral.pop();
        }
        for (uint256 i = 0; i < collateral.length; i++) {
            conf.collateral[i] = collateral[i];
        }
        if (selectBasket) return _selectBasket();
        else return false;
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

    // ==== Internal ====

    function _updateBasket() internal {
        for (uint256 i = 0; i < _assets.length(); i++) {
            if (IAsset(_assets.at(i)).isCollateral()) {
                ICollateral(_assets.at(i)).forceUpdates();
            }
        }
        if (worstCollateralStatus() == CollateralStatus.DISABLED) {
            _selectBasket();
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

    /// Select and save the next basket, based on the BasketConfig and Collateral statuses
    /// @return whether or not a new basket was derived from templates
    function _selectBasket() private returns (bool) {
        return false;
    }
}
