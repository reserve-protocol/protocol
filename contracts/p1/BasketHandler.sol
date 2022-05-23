// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IBasketHandler.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p1/mixins/Component.sol";

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
    uint32 nonce;
    uint32 timestamp;
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
        uint256 length = self.erc20s.length;
        for (uint256 i = 0; i < length; ++i) {
            self.refAmts[self.erc20s[i]] = FIX_ZERO;
        }
        delete self.erc20s;
        self.nonce++;
        self.timestamp = uint32(block.timestamp);
        self.disabled = false;
    }

    /// Set `self` equal to `other`
    function copy(Basket storage self, Basket storage other) internal {
        empty(self);
        uint256 length = other.erc20s.length;
        for (uint256 i = 0; i < length; ++i) {
            self.erc20s.push(other.erc20s[i]);
            self.refAmts[other.erc20s[i]] = other.refAmts[other.erc20s[i]];
        }
        self.nonce++;
        self.timestamp = uint32(block.timestamp);
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
        self.timestamp = uint32(block.timestamp);
    }
}

/**
 * @title BasketHandler
 * @notice Handles the basket configuration, definition, and evolution over time.
 */
contract BasketHandlerP1 is ComponentP1, IBasketHandler {
    using BasketLib for Basket;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using FixLib for uint192;

    BasketConfig private config;
    Basket private basket;

    function init(IMain main_) external initializer {
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

    /// Check the basket for default and swaps it if necessary
    /// @custom:refresher
    function refreshBasket() external notPaused {
        if (status() == CollateralStatus.DISABLED) {
            _switchBasket();
        }
    }

    /// Set the prime basket in the basket configuration, in terms of erc20s and target amounts
    /// @param erc20s The collateral for the new prime basket
    /// @param targetAmts The target amounts (in) {target/BU} for the new prime basket
    /// @custom:governance
    function setPrimeBasket(IERC20[] calldata erc20s, uint192[] calldata targetAmts)
        external
        governance
    {
        // withLockable not required: no external calls
        require(erc20s.length == targetAmts.length, "must be same length");
        delete config.erc20s;
        IAssetRegistry reg = main.assetRegistry();
        bytes32[] memory names = new bytes32[](erc20s.length);

        for (uint256 i = 0; i < erc20s.length; ++i) {
            // This is a nice catch to have, but in general it is possible for
            // an ERC20 in the prime basket to have its asset unregistered.
            require(reg.toAsset(erc20s[i]).isCollateral(), "token is not collateral");

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
        IERC20[] calldata erc20s
    ) external governance {
        // withLockable not required: no external calls
        BackupConfig storage conf = config.backups[targetName];
        conf.max = max;
        delete conf.erc20s;
        IAssetRegistry reg = main.assetRegistry();

        for (uint256 i = 0; i < erc20s.length; ++i) {
            // This is a nice catch to have, but in general it is possible for
            // an ERC20 in the backup config to have its asset altered.
            require(reg.toAsset(erc20s[i]).isCollateral(), "token is not collateral");

            conf.erc20s.push(erc20s[i]);
        }
        emit BackupConfigSet(targetName, max, erc20s);
    }

    /// Switch the basket, only callable directly by governance
    /// @custom:interaction CEI
    /// @custom:governance
    function switchBasket() external governance {
        // == Refresh ==
        main.assetRegistry().refresh();
        // then maybe lots of state changes
        _switchBasket();
    }

    /// @return Whether it holds enough basket units of collateral
    function fullyCapitalized() external view returns (bool) {
        return basketsHeldBy(address(main.backingManager())) >= main.rToken().basketsNeeded();
    }

    /// @return nonce The current basket nonce
    /// @return timestamp The timestamp when the basket was last set
    function lastSet() external view returns (uint256 nonce, uint256 timestamp) {
        nonce = basket.nonce;
        timestamp = basket.timestamp;
    }

    /// @return status_ The status of the basket
    function status() public view returns (CollateralStatus status_) {
        if (basket.disabled) return CollateralStatus.DISABLED;

        uint256 length = basket.erc20s.length;
        for (uint256 i = 0; i < length; ++i) {
            try main.assetRegistry().toColl(basket.erc20s[i]) returns (ICollateral coll) {
                CollateralStatus s = coll.status();
                if (s == CollateralStatus.DISABLED) return CollateralStatus.DISABLED;

                if (uint256(s) > uint256(status_)) status_ = s;
            } catch {
                return CollateralStatus.DISABLED;
            }
        }
    }

    /// @return {tok/BU} The quantity of an ERC20 token in the basket; 0 if not in the basket
    function quantity(IERC20 erc20) public view returns (uint192) {
        try main.assetRegistry().toColl(erc20) returns (ICollateral coll) {
            if (coll.status() == CollateralStatus.DISABLED) return FIX_ZERO;

            // {tok/BU} = {ref/BU} / {ref/tok}
            return basket.refAmts[erc20].div(coll.refPerTok(), CEIL);
        } catch {
            return FIX_ZERO;
        }
    }

    /// @return p {UoA/BU} The protocol's best guess at what a BU would be priced at in UoA
    function price() external view returns (uint192 p) {
        uint256 length = basket.erc20s.length;
        for (uint256 i = 0; i < length; ++i) {
            ICollateral coll = main.assetRegistry().toColl(basket.erc20s[i]);
            if (coll.status() != CollateralStatus.DISABLED) {
                p = p.plus(coll.price().mul(quantity(basket.erc20s[i])));
            }
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
    /// @dev Returns FIX_MAX for an empty basket
    function basketsHeldBy(address account) public view returns (uint192 baskets) {
        if (basket.disabled) return FIX_ZERO;
        baskets = FIX_MAX;

        uint256 length = basket.erc20s.length;
        for (uint256 i = 0; i < length; ++i) {
            try main.assetRegistry().toColl(basket.erc20s[i]) returns (ICollateral coll) {
                if (coll.status() == CollateralStatus.DISABLED) return FIX_ZERO;

                uint192 bal = coll.bal(account); // {tok}

                // {tok/BU} = {ref/BU} / {ref/tok}
                uint192 q = basket.refAmts[basket.erc20s[i]].div(coll.refPerTok(), CEIL);

                // {BU} = {tok} / {tok/BU}
                baskets = fixMin(baskets, bal.div(q));
            } catch {
                return FIX_ZERO;
            }
        }
        if (baskets == FIX_MAX) return FIX_ZERO;
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
        for (uint256 i = 0; i < config.erc20s.length; ++i) {
            targetNames.add(config.targetNames[config.erc20s[i]]);
        }

        // Here, "good" collateral is non-disabled collateral; any status other than DISABLED
        // goodWeights and totalWeights are in index-correspondence with targetNames

        // {target/BU} total target weight of good, prime collateral with target i
        uint192[] memory goodWeights = new uint192[](targetNames.length());

        // {target/BU} total target weight of all prime collateral with target i
        uint192[] memory totalWeights = new uint192[](targetNames.length());

        // For each prime collateral token:
        for (uint256 i = 0; i < config.erc20s.length; ++i) {
            IERC20 erc20 = config.erc20s[i];

            // Find collateral's targetName index
            uint256 targetIndex;
            for (targetIndex = 0; targetIndex < targetNames.length(); ++targetIndex) {
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
        for (uint256 i = 0; i < targetNames.length(); ++i) {
            if (totalWeights[i].lte(goodWeights[i])) continue; // Don't need backup weight

            uint256 size = 0; // backup basket size
            BackupConfig storage backup = config.backups[targetNames.at(i)];

            // Find the backup basket size: min(backup.max, # of good backup collateral)
            for (uint256 j = 0; j < backup.erc20s.length && size < backup.max; ++j) {
                if (goodCollateral(backup.erc20s[j])) size++;
            }

            // Remove bad collateral and mark basket disabled; pauses most protocol functions
            if (size == 0) newBasket.disabled = true;

            // Set backup basket weights
            uint256 assigned = 0;
            uint192 needed = totalWeights[i].minus(goodWeights[i]);
            uint192 fixSize = toFix(size);
            for (uint256 j = 0; j < backup.erc20s.length && assigned < size; ++j) {
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
        for (uint256 i = 0; i < basket.erc20s.length; ++i) {
            refAmts[i] = basket.refAmts[basket.erc20s[i]];
        }
        emit BasketSet(basket.erc20s, refAmts, basket.disabled);
    }

    /// Good collateral is both (i) registered, (ii) collateral, and (iii) not DISABLED
    function goodCollateral(IERC20 erc20) private view returns (bool) {
        try main.assetRegistry().toColl(erc20) returns (ICollateral coll) {
            return coll.status() != CollateralStatus.DISABLED;
        } catch {
            return false;
        }
    }
}
