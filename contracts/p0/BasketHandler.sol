// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/p0/mixins/Component.sol";
import "contracts/libraries/Array.sol";
import "contracts/libraries/Fixed.sol";

struct BackupConfig {
    uint256 max; // Maximum number of backup collateral erc20s to use in a basket
    IERC20[] erc20s; // Ordered list of backup collateral ERC20s
}

struct BasketConfig {
    // The collateral erc20s in the prime (explicitly governance-set) basket
    IERC20[] erc20s;
    // Amount of target units per basket for each prime collateral token. {target/BU}
    mapping(IERC20 => uint192) targetAmts;
    // Cached view of the target unit for each erc20 upon setup
    mapping(IERC20 => bytes32) targetNames;
    // Backup configurations, per target name.
    mapping(bytes32 => BackupConfig) backups;
}

/// A reference basket that provides a dynamic definition of a basket unit (BU)
/// Can be empty if all collateral defaults
struct Basket {
    IERC20[] erc20s; // Weak Invariant: after `refreshBasket`, no bad collateral || disabled
    mapping(IERC20 => uint192) refAmts; // {ref/BU}
    uint256 nonce;
    uint256 timestamp;
    bool disabled;
    // Invariant: targetAmts == refAmts.map(amt => amt * coll.targetPerRef()) || disabled
}

/*
 * @title BasketLib
 */
library BasketLib {
    using BasketLib for Basket;
    using FixLib for uint192;

    // Empty self
    function empty(Basket storage self) internal {
        for (uint256 i = 0; i < self.erc20s.length; i++) {
            self.refAmts[self.erc20s[i]] = FIX_ZERO;
        }
        delete self.erc20s;
        self.nonce++;
        self.timestamp = block.timestamp;
        self.disabled = false;
    }

    /// Set `self` equal to `other`
    function copy(Basket storage self, Basket storage other) internal {
        empty(self); // updates nonce
        for (uint256 i = 0; i < other.erc20s.length; i++) {
            self.erc20s.push(other.erc20s[i]);
            self.refAmts[other.erc20s[i]] = other.refAmts[other.erc20s[i]];
        }
        self.timestamp = block.timestamp;
        self.disabled = other.disabled;
    }

    /// Add `weight` to the refAmount of collateral token `tok` in the basket `self`
    function add(
        Basket storage self,
        IERC20 tok,
        uint192 weight
    ) internal {
        if (self.refAmts[tok].eq(FIX_ZERO)) {
            self.erc20s.push(tok);
            self.refAmts[tok] = weight;
        } else {
            self.refAmts[tok] = self.refAmts[tok].plus(weight);
        }
        self.nonce++;
        self.timestamp = block.timestamp;
    }
}

/**
 * @title BasketHandler
 * @notice Handles the basket configuration, definition, and evolution over time.
 */
contract BasketHandlerP0 is ComponentP0, IBasketHandler {
    using BasketLib for Basket;
    using CollateralStatusComparator for CollateralStatus;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using FixLib for uint192;

    uint192 public constant MAX_TARGET_AMT = 1e3 * FIX_ONE; // {target/BU} max basket weight

    BasketConfig private config;
    Basket private basket;

    function init(IMain main_) public initializer {
        __Component_init(main_);
    }

    /// Disable the basket in order to schedule a basket refresh
    /// @custom:protected
    function disableBasket() external {
        require(_msgSender() == address(main.assetRegistry()), "asset registry only");
        uint192[] memory refAmts = new uint192[](basket.erc20s.length);
        emit BasketSet(basket.erc20s, refAmts, true);
        basket.disabled = true;
    }

    /// Switch the basket, only callable directly by governance
    /// @custom:interaction OR @custom:governance
    function refreshBasket() external {
        main.assetRegistry().refresh();

        require(
            main.hasRole(OWNER, _msgSender()) ||
                (status() == CollateralStatus.DISABLED && !main.pausedOrFrozen()),
            "basket unrefreshable"
        );
        _switchBasket();
    }

    /// Set the prime basket in the basket configuration, in terms of erc20s and target amounts
    /// @param erc20s The collateral for the new prime basket
    /// @param targetAmts The target amounts (in) {target/BU} for the new prime basket
    /// @custom:governance
    function setPrimeBasket(IERC20[] memory erc20s, uint192[] memory targetAmts)
        external
        governance
    {
        require(erc20s.length == targetAmts.length, "must be same length");
        requireValidCollArray(erc20s);
        delete config.erc20s;
        IAssetRegistry reg = main.assetRegistry();
        bytes32[] memory names = new bytes32[](erc20s.length);

        for (uint256 i = 0; i < erc20s.length; i++) {
            // This is a nice catch to have, but in general it is possible for
            // an ERC20 in the prime basket to have its asset unregistered.
            require(reg.toAsset(erc20s[i]).isCollateral(), "token is not collateral");
            require(0 < targetAmts[i], "invalid target amount; must be nonzero");
            require(targetAmts[i] <= MAX_TARGET_AMT, "invalid target amount; too large");

            config.erc20s.push(erc20s[i]);
            config.targetAmts[erc20s[i]] = targetAmts[i];
            names[i] = reg.toColl(erc20s[i]).targetName();
            config.targetNames[erc20s[i]] = names[i];
        }

        emit PrimeBasketSet(erc20s, targetAmts, names);
    }

    /// Set the backup configuration for some target name
    /// @custom:governance
    function setBackupConfig(
        bytes32 targetName,
        uint256 max,
        IERC20[] memory erc20s
    ) external governance {
        requireValidCollArray(erc20s);
        BackupConfig storage conf = config.backups[targetName];
        conf.max = max;
        delete conf.erc20s;
        IAssetRegistry reg = main.assetRegistry();

        for (uint256 i = 0; i < erc20s.length; i++) {
            // This is a nice catch to have, but in general it is possible for
            // an ERC20 in the backup config to have its asset altered.
            // In that case the basket is set to disabled.
            require(reg.toAsset(erc20s[i]).isCollateral(), "token is not collateral");

            conf.erc20s.push(erc20s[i]);
        }
        emit BackupConfigSet(targetName, max, erc20s);
    }

    /// @return Whether it holds enough basket units of collateral
    function fullyCollateralized() external view returns (bool) {
        return basketsHeldBy(address(main.backingManager())).gte(main.rToken().basketsNeeded());
    }

    /// @return nonce The current basket nonce
    /// @return timestamp The timestamp when the basket was last set
    function lastSet() external view returns (uint256 nonce, uint256 timestamp) {
        nonce = basket.nonce;
        timestamp = basket.timestamp;
    }

    /// @return status_ The worst collateral status of the basket
    function status() public view returns (CollateralStatus status_) {
        if (basket.disabled) return CollateralStatus.DISABLED;

        for (uint256 i = 0; i < basket.erc20s.length; i++) {
            if (!goodCollateral(basket.erc20s[i])) return CollateralStatus.DISABLED;

            CollateralStatus s = main.assetRegistry().toColl(basket.erc20s[i]).status();
            if (s.worseThan(status_)) status_ = s;
        }
    }

    /// @return {tok/BU} The quantity of an ERC20 token in the basket; 0 if not in the basket
    function quantity(IERC20 erc20) public view returns (uint192) {
        if (!goodCollateral(erc20)) return FIX_ZERO;

        // {tok/BU} = {ref/BU} / {ref/tok}
        return basket.refAmts[erc20].div(main.assetRegistry().toColl(erc20).refPerTok(), CEIL);
    }

    /// @return p {UoA/BU} The protocol's best guess at what a BU would be priced at in UoA
    function price() external view returns (uint192 p) {
        for (uint256 i = 0; i < basket.erc20s.length; i++) {
            if (!goodCollateral(basket.erc20s[i])) continue;

            IERC20 erc20 = basket.erc20s[i];
            p = p.plus(main.assetRegistry().toColl(erc20).price().mul(quantity(erc20)));
        }
    }

    /// @param amount {BU}
    /// @return erc20s The backing collateral erc20s
    /// @return quantities {qTok} ERC20 token quantities equal to `amount` BUs
    function quote(uint192 amount, RoundingMode rounding)
        external
        view
        returns (address[] memory erc20s, uint256[] memory quantities)
    {
        erc20s = new address[](basket.erc20s.length);
        quantities = new uint256[](basket.erc20s.length);
        uint256 length = basket.erc20s.length;
        for (uint256 i = 0; i < length; ++i) {
            erc20s[i] = address(basket.erc20s[i]);

            // {qTok} = {tok/BU} * {BU} * {tok} * {qTok/tok}
            quantities[i] = quantity(basket.erc20s[i]).mul(amount, rounding).shiftl_toUint(
                int8(IERC20Metadata(address(basket.erc20s[i])).decimals()),
                rounding
            );
        }
    }

    /// @return baskets {BU} The balance of basket units held by `account`
    /// @dev Returns FIX_ZERO for an empty basket
    function basketsHeldBy(address account) public view returns (uint192 baskets) {
        if (basket.erc20s.length == 0 || basket.disabled) return FIX_ZERO;
        baskets = FIX_MAX;
        for (uint256 i = 0; i < basket.erc20s.length; i++) {
            uint192 bal = main.assetRegistry().toColl(basket.erc20s[i]).bal(account);
            uint192 q = quantity(basket.erc20s[i]); // {tok/BU}

            // {BU} = {tok} / {tok/BU}
            if (q.eq(FIX_ZERO)) return FIX_ZERO;
            else baskets = fixMin(baskets, bal.div(q));
        }
    }

    // These are effectively local variables of _switchBasket. Nothing should use its value
    // from a previous transaction.
    EnumerableSet.Bytes32Set private targetNames;
    Basket private newBasket;

    /// Select and save the next basket, based on the BasketConfig and Collateral statuses
    function _switchBasket() private {
        IAssetRegistry reg = main.assetRegistry();

        while (targetNames.length() > 0) targetNames.remove(targetNames.at(0));
        newBasket.empty();

        // Count unique targets
        for (uint256 i = 0; i < config.erc20s.length; i++) {
            targetNames.add(config.targetNames[config.erc20s[i]]);
        }

        // Here, "good" collateral is non-disabled collateral; any status other than DISABLED
        // goodWeights and totalWeights are in index-correspondence with targetNames

        // {target/BU} total target weight of good, prime collateral with target i
        uint192[] memory goodWeights = new uint192[](targetNames.length());

        // {target/BU} total target weight of all prime collateral with target i
        uint192[] memory totalWeights = new uint192[](targetNames.length());

        // For each prime collateral token:
        for (uint256 i = 0; i < config.erc20s.length; i++) {
            IERC20 erc20 = config.erc20s[i];

            // Find collateral's targetName index
            uint256 targetIndex;
            for (targetIndex = 0; targetIndex < targetNames.length(); targetIndex++) {
                if (targetNames.at(targetIndex) == config.targetNames[erc20]) break;
            }
            assert(targetIndex < targetNames.length());

            // Set basket weights for good, prime collateral,
            // and accumulate the values of goodWeights and targetWeights
            uint192 targetWeight = config.targetAmts[erc20];
            totalWeights[targetIndex] = totalWeights[targetIndex].plus(targetWeight);

            if (goodCollateral(erc20) && targetWeight.gt(FIX_ZERO)) {
                goodWeights[targetIndex] = goodWeights[targetIndex].plus(targetWeight);
                newBasket.add(erc20, targetWeight.div(reg.toColl(erc20).targetPerRef(), CEIL));
            }
        }

        // For each target i, if we still need more weight for target i then try to add the backup
        // basket for target i to make up that weight:
        for (uint256 i = 0; i < targetNames.length(); i++) {
            if (totalWeights[i].lte(goodWeights[i])) continue; // Don't need backup weight

            uint256 size = 0; // backup basket size
            BackupConfig storage backup = config.backups[targetNames.at(i)];

            // Find the backup basket size: min(backup.max, # of good backup collateral)
            for (uint256 j = 0; j < backup.erc20s.length && size < backup.max; j++) {
                if (goodCollateral(backup.erc20s[j])) size++;
            }

            // If we need backup collateral, but there's no good backup collateral, basket default!
            // Remove bad collateral and mark basket disabled; pauses most protocol functions
            if (size == 0) newBasket.disabled = true;

            // Set backup basket weights
            uint256 assigned = 0;
            uint192 needed = totalWeights[i].minus(goodWeights[i]);
            uint192 fixSize = toFix(size);
            for (uint256 j = 0; j < backup.erc20s.length && assigned < size; j++) {
                IERC20 erc20 = backup.erc20s[j];
                if (goodCollateral(erc20)) {
                    newBasket.add(
                        erc20,
                        needed.div(fixSize, CEIL).div(reg.toColl(erc20).targetPerRef(), CEIL)
                    );
                    assigned++;
                }
            }
        }

        basket.copy(newBasket);

        // Keep records, emit event
        uint192[] memory refAmts = new uint192[](basket.erc20s.length);
        for (uint256 i = 0; i < basket.erc20s.length; i++) {
            refAmts[i] = basket.refAmts[basket.erc20s[i]];
        }
        emit BasketSet(basket.erc20s, refAmts, basket.disabled);
    }

    /// Require that erc20s is a "valid collateral array"
    // i.e, it contains no duplicates, no instances of rsr, strsr, rtoken, or the 0 address
    function requireValidCollArray(IERC20[] memory erc20s) internal view {
        IERC20 rsr = main.rsr();
        IERC20 rToken = IERC20(address(main.rToken()));
        IERC20 stRSR = IERC20(address(main.stRSR()));
        IERC20 zero = IERC20(address(0));

        for (uint256 i = 0; i < erc20s.length; i++) {
            require(erc20s[i] != rsr, "RSR is not valid collateral");
            require(erc20s[i] != rToken, "RToken is not valid collateral");
            require(erc20s[i] != stRSR, "stRSR is not valid collateral");
            require(erc20s[i] != zero, "address zero is not valid collateral");
        }
        require(ArrayLib.allUnique(erc20s), "contains duplicates");
    }

    /// Good collateral is: registered, Collateral, not DISABLED, and not a forbidden token
    function goodCollateral(IERC20 erc20) private view returns (bool) {
        if (erc20 == IERC20(address(0))) return false;
        if (erc20 == main.rsr()) return false;
        if (erc20 == IERC20(address(main.rToken()))) return false;
        if (erc20 == IERC20(address(main.stRSR()))) return false;

        IAssetRegistry reg = main.assetRegistry();
        return
            reg.isRegistered(erc20) &&
            reg.toAsset(erc20).isCollateral() &&
            reg.toColl(erc20).status() != CollateralStatus.DISABLED;
    }
}
