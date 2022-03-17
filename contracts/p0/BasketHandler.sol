// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/p0/mixins/Component.sol";
import "contracts/libraries/Fixed.sol";

struct BackupConfig {
    uint256 max; // Maximum number of backup collateral erc20s to use in a basket
    IERC20[] erc20s; // Ordered list of backup collateral ERC20s
}

struct BasketConfig {
    // The collateral erc20s in the prime (explicitly governance-set) basket
    IERC20[] erc20s;
    // Amount of target units per basket for each prime collateral token. {target/BU}
    mapping(IERC20 => int192) targetAmts;
    // Backup configurations, per target name.
    mapping(bytes32 => BackupConfig) backups;
}

/// A specific definition of a BU that evolves over time according to the BasketConfig
struct Basket {
    // Invariant: all reference basket collateral must be registered with the registry
    IERC20[] erc20s;
    mapping(IERC20 => int192) refAmts; // {ref/BU}
    uint256 nonce;
    uint256 timestamp;
}

/*
 * @title BasketLib
 */
library BasketLib {
    using BasketLib for Basket;
    using FixLib for int192;

    // Empty self
    function empty(Basket storage self) internal {
        for (uint256 i = 0; i < self.erc20s.length; i++) {
            self.refAmts[self.erc20s[i]] = FIX_ZERO;
        }
        delete self.erc20s;
        self.nonce++;
        self.timestamp = block.timestamp;
    }

    /// Set `self` equal to `other`
    function copy(Basket storage self, Basket storage other) internal {
        empty(self);
        for (uint256 i = 0; i < other.erc20s.length; i++) {
            self.erc20s.push(other.erc20s[i]);
            self.refAmts[other.erc20s[i]] = other.refAmts[other.erc20s[i]];
        }
        self.nonce++;
        self.timestamp = block.timestamp;
    }

    /// Add `weight` to the refAmount of collateral token `tok` in the basket `self`
    function add(
        Basket storage self,
        IERC20 tok,
        int192 weight
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
contract BasketHandlerP0 is Component, IBasketHandler {
    using BasketLib for Basket;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using FixLib for int192;

    BasketConfig private config;
    Basket private basket;

    /// Try to ensure the current basket is valid, switching it if necessary
    function ensureBasket() external notPaused {
        main.assetRegistry().forceUpdates();

        if (status() == CollateralStatus.DISABLED) {
            _switchBasket();
        }
    }

    /// Set the prime basket in the basket configuration, in terms of erc20s and target amounts
    /// @param erc20s The collateral for the new prime basket
    /// @param targetAmts The target amounts (in) {target/BU} for the new prime basket
    function setPrimeBasket(IERC20[] memory erc20s, int192[] memory targetAmts) public onlyOwner {
        require(erc20s.length == targetAmts.length, "must be same length");
        delete config.erc20s;
        IAssetRegistry reg = main.assetRegistry();

        for (uint256 i = 0; i < erc20s.length; i++) {
            require(reg.toAsset(erc20s[i]).isCollateral(), "token is not collateral");

            config.erc20s.push(erc20s[i]);
            config.targetAmts[erc20s[i]] = targetAmts[i];
        }

        emit PrimeBasketSet(erc20s, targetAmts);
    }

    /// Set the backup configuration for some target name.
    function setBackupConfig(
        bytes32 targetName,
        uint256 max,
        IERC20[] memory erc20s
    ) public onlyOwner {
        BackupConfig storage conf = config.backups[targetName];
        conf.max = max;
        delete conf.erc20s;
        IAssetRegistry reg = main.assetRegistry();

        for (uint256 i = 0; i < erc20s.length; i++) {
            require(reg.toAsset(erc20s[i]).isCollateral(), "token is not collateral");

            conf.erc20s.push(erc20s[i]);
        }
        emit BackupConfigSet(targetName, max, erc20s);
    }

    /// @return true if we registered a change in the underlying reference basket
    function switchBasket() external onlyOwner returns (bool) {
        return _switchBasket();
    }

    /// @return Whether it holds enough basket units of collateral
    function fullyCapitalized() external view returns (bool) {
        return basketsHeldBy(address(main.backingManager())).gte(main.rToken().basketsNeeded());
    }

    /// @return nonce The current basket nonce
    /// @return timestamp The timestamp when the basket was last set
    function lastSet() external view returns (uint256 nonce, uint256 timestamp) {
        nonce = basket.nonce;
        timestamp = basket.timestamp;
    }

    /// @return status_ The maximum CollateralStatus among basket collateral
    function status() public view returns (CollateralStatus status_) {
        IAssetRegistry reg = main.assetRegistry();

        for (uint256 i = 0; i < basket.erc20s.length; i++) {
            IERC20 erc20 = basket.erc20s[i];
            CollateralStatus statusI;
            if (!reg.isRegistered(erc20)) statusI = CollateralStatus.DISABLED;
            else statusI = reg.toColl(erc20).status();

            if (uint256(statusI) > uint256(status_)) {
                status_ = statusI;
                if (status_ == CollateralStatus.DISABLED) return status_;
            }
        }
    }

    /// @return {tok/BU} The quantity of collateral in the basket
    function quantity(IERC20 erc20) public view returns (int192) {
        IAssetRegistry reg = main.assetRegistry();
        if (!reg.isRegistered(erc20) || !reg.toAsset(erc20).isCollateral()) return FIX_ZERO;

        // {qTok/BU} = {ref/BU} / {ref/tok}
        return basket.refAmts[erc20].div(reg.toColl(erc20).refPerTok());
    }

    /// @return p {UoA/BU} The protocol's best guess at what a BU would be priced at in UoA
    function price() public view returns (int192 p) {
        IAssetRegistry reg = main.assetRegistry();

        for (uint256 i = 0; i < basket.erc20s.length; i++) {
            IERC20 erc20 = basket.erc20s[i];
            ICollateral coll = reg.toColl(erc20);

            if (coll.status() != CollateralStatus.DISABLED) {
                p = p.plus(coll.price().mul(quantity(erc20)));
            }
        }
    }

    /// @param amount {BU}
    /// @return erc20s The backing collateral erc20s
    /// @return quantities {qTok} ERC20 token quantities equal to `amount` BUs
    function quote(int192 amount, RoundingApproach rounding)
        public
        view
        returns (address[] memory erc20s, uint256[] memory quantities)
    {
        erc20s = new address[](basket.erc20s.length);
        quantities = new uint256[](basket.erc20s.length);
        for (uint256 i = 0; i < basket.erc20s.length; i++) {
            uint8 decimals = main.assetRegistry().toAsset(basket.erc20s[i]).erc20().decimals();

            // {qTok} = {BU} * {tok/BU} * {qTok/tok}
            int192 q = amount.mul(quantity(basket.erc20s[i])).shiftLeft(int8(decimals));
            quantities[i] = q.toUint(rounding);
            erc20s[i] = address(basket.erc20s[i]);
        }
    }

    /// @return baskets {BU} The balance of basket units held by `account`
    function basketsHeldBy(address account) public view returns (int192 baskets) {
        baskets = FIX_MAX;
        for (uint256 i = 0; i < basket.erc20s.length; i++) {
            int192 bal = main.assetRegistry().toAsset(basket.erc20s[i]).bal(account); // {tok}
            int192 q = quantity(basket.erc20s[i]); // {tok/BU}

            // baskets {BU} = bal {tok} / q {tok/BU}
            if (q.gt(FIX_ZERO)) baskets = fixMin(baskets, bal.div(q));
        }
    }

    // These are effectively local variables of _switchBasket. Nothing should use its value
    // from a previous transaction.
    EnumerableSet.Bytes32Set private targetNames;
    Basket private newBasket;

    /// Select and save the next basket, based on the BasketConfig and Collateral statuses
    /// @return whether or not a new basket was derived from templates
    function _switchBasket() private returns (bool) {
        IAssetRegistry reg = main.assetRegistry();

        while (targetNames.length() > 0) targetNames.remove(targetNames.at(0));
        newBasket.empty();

        // Count unique targets
        for (uint256 i = 0; i < config.erc20s.length; i++) {
            targetNames.add(reg.toColl(config.erc20s[i]).targetName());
        }

        // Here, "good" collateral is non-defaulted collateral; any status other than DISABLED
        // goodWeights and totalWeights are in index-correspondence with targetNames

        // {target/BU} total target weight of good, prime collateral with target i
        int192[] memory goodWeights = new int192[](targetNames.length());

        // {target/BU} total target weight of all prime collateral with target i
        int192[] memory totalWeights = new int192[](targetNames.length());

        // For each prime collateral token:
        for (uint256 i = 0; i < config.erc20s.length; i++) {
            IERC20 erc20 = config.erc20s[i];
            if (!reg.isRegistered(erc20)) continue; // skip unregistered collateral erc20s

            ICollateral coll = reg.toColl(erc20);

            // Find coll's targetName index
            uint256 targetIndex;
            for (targetIndex = 0; targetIndex < targetNames.length(); targetIndex++) {
                if (targetNames.at(targetIndex) == coll.targetName()) break;
            }
            assert(targetIndex < targetNames.length());

            // Set basket weights for good, prime collateral,
            // and accumulate the values of goodWeights and targetWeights
            int192 targetWeight = config.targetAmts[erc20];
            totalWeights[targetIndex] = totalWeights[targetIndex].plus(targetWeight);

            if (coll.status() != CollateralStatus.DISABLED) {
                goodWeights[targetIndex] = goodWeights[targetIndex].plus(targetWeight);
                newBasket.add(erc20, targetWeight.div(coll.targetPerRef()));
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
                IERC20 erc20 = backup.erc20s[j];
                if (
                    reg.isRegistered(erc20) &&
                    reg.toColl(erc20).status() != CollateralStatus.DISABLED
                ) {
                    size++;
                }
            }

            // If we need backup collateral, but there's no good backup collateral, it's a bad case!
            // Do not set the basket; the protocol will stay issuance-paused until governance acts.
            if (size == 0) return false;

            // Set backup basket weights
            uint256 assigned = 0;
            for (uint256 j = 0; j < backup.erc20s.length && assigned < size; j++) {
                IERC20 erc20 = backup.erc20s[j];
                if (
                    reg.isRegistered(erc20) &&
                    reg.toColl(erc20).status() != CollateralStatus.DISABLED
                ) {
                    newBasket.add(erc20, totalWeights[i].minus(goodWeights[i]).divu(size));
                    assigned++;
                }
            }
        }

        // If we haven't already given up, then commit the new basket!
        basket.copy(newBasket);

        // Keep records, emit event
        int192[] memory refAmts = new int192[](basket.erc20s.length);
        for (uint256 i = 0; i < basket.erc20s.length; i++) {
            refAmts[i] = basket.refAmts[basket.erc20s[i]];
        }
        emit BasketSet(basket.erc20s, refAmts);

        return true;
    }
}
