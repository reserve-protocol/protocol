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
    // An enumeration of the target names in collateral
    bytes32[] targetNames;
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
        _ensureValidBasket();
    }

    /// Set the prime basket in the basket configuration.
    /// @param collateral The collateral for the new prime basket
    /// @param targetAmts The target amounts (in) {target/BU} for the new prime basket
    function setPrimeBasket(ICollateral[] memory collateral, Fix[] memory targetAmts)
        public
        override
        onlyOwner
    {
        require(collateral.length == targetAmts.length, "must be same length");
        delete basketConf.collateral;
        delete basketConf.targetNames;

        for (uint256 i = 0; i < collateral.length; i++) {
            ICollateral coll = collateral[i];
            basketConf.collateral.push(coll);
            basketConf.targetAmts[coll] = targetAmts[i];

            // Add coll's target name to basketConf.targetNames if it's not already there.
            bytes32 targetName = coll.targetName();
            uint256 j;
            for (j = 0; j < basketConf.targetNames.length; j++) {
                if (basketConf.targetNames[j] == targetName) break;
            }
            if (j >= basketConf.targetNames.length) {
                basketConf.targetNames.push(targetName);
            }
        }
    }

    /// Set the backup configuration for some target name.
    function setBackupConfig(
        bytes32 targetName,
        uint256 maxCollateral,
        ICollateral[] memory collateral
    ) public override onlyOwner {
        BackupConfig storage conf = basketConf.backups[targetName];
        conf.maxCollateral = maxCollateral;

        while (conf.collateral.length > collateral.length) {
            conf.collateral.pop();
        }
        for (uint256 i = 0; i < collateral.length; i++) {
            conf.collateral[i] = collateral[i];
        }
    }

    /// @return true if we registered a change in the underlying basket
    function switchBasket() public override onlyOwner returns (bool) {
        return _switchBasket();
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

    // Check collateral statuses; Select a new basket if needed.
    function _ensureValidBasket() internal {
        for (uint256 i = 0; i < _assets.length(); i++) {
            if (IAsset(_assets.at(i)).isCollateral()) {
                ICollateral(_assets.at(i)).forceUpdates();
            }
        }
        if (worstCollateralStatus() == CollateralStatus.DISABLED) {
            _switchBasket();
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

    // newBasket is effectively a local variable of _switchBasket. Nothing should use its value
    // from a previous transaction.
    Basket private newBasket;

    /// Select and save the next basket, based on the BasketConfig and Collateral statuses
    /// @return whether or not a new basket was derived from templates
    function _switchBasket() private returns (bool) {
        // Here, "good" collateral is non-defaulted collateral; any status other than DISABLED
        // goodWeights and totalWeights are in index-correspondence with basketConf.targetNames
        Fix[] memory goodWeights; // total target weight of good, prime collateral with target i
        Fix[] memory totalWeights; // total target weight of all prime collateral with target i
        newBasket.empty();

        // For each prime collateral:
        for (uint256 i = 0; i < basketConf.collateral.length; i++) {
            ICollateral coll = basketConf.collateral[i];

            // Find coll's targetName index
            uint256 targetIndex;
            for (targetIndex = 0; targetIndex < basketConf.targetNames.length; targetIndex++) {
                if (basketConf.targetNames[targetIndex] == coll.targetName()) break;
            }
            assert(targetIndex < basketConf.targetNames.length);

            // Set basket weights for good, prime collateral,
            // and accumulate the values of goodWeights and targetWeights
            Fix targetWeight = basketConf.targetAmts[coll];
            totalWeights[targetIndex] = totalWeights[targetIndex].plus(targetWeight);

            if (coll.status() != CollateralStatus.DISABLED) {
                goodWeights[targetIndex] = goodWeights[targetIndex].plus(targetWeight);
                // Add collateral to newBasket
                newBasket.collateral[newBasket.size] = coll;
                newBasket.refTargets[coll] = targetWeight.mul(coll.targetRate());
                newBasket.size++;
            }
        }

        // For each target i, if we still need more weight for target i then try to add the backup
        // basket for target i to make up that weight:
        for (uint256 i = 0; i < basketConf.targetNames.length; i++) {
            if (totalWeights[i].lte(goodWeights[i])) continue; // Don't need backup weight

            uint256 size = 0; // backup basket size
            BackupConfig storage backup = basketConf.backups[basketConf.targetNames[i]];

            // Find the backup basket size: max(1, maxCollateral, # of good backup collateral)
            for (uint256 j = 0; j < backup.collateral.length; j++) {
                if (backup.collateral[j].status() != CollateralStatus.DISABLED) {
                    size++;
                    if (size >= backup.maxCollateral) break;
                }
            }

            // If we need backup collateral, but there's no good backup collateral, then we're in a
            // bad case! Do not change the basket; the protocol will remain issuance-paused until
            // governance acts.
            if (size == 0) return false;

            // Set backup basket weights
            uint256 assigned = 0;
            for (uint256 j = 0; j < backup.collateral.length && assigned < size; j++) {
                ICollateral coll = backup.collateral[j];
                if (coll.status() != CollateralStatus.DISABLED) {
                    // Add backup asset to newBasket
                    newBasket.collateral[newBasket.size] = coll;
                    newBasket.refTargets[coll] = totalWeights[i].minus(goodWeights[i]).divu(size);
                    newBasket.size++;
                    assigned++;
                }
            }
        }

        // If we haven't already given up, then commit the new basket!
        _basket.copy(newBasket);
        return true;
    }
}
