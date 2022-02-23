// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/libraries/Basket.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/main/AssetRegistry.sol";
import "contracts/p0/main/SettingsHandler.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/Pausable.sol";

struct BackupConfig {
    uint256 max; // Maximum number of backup collateral tokens to use in a basket
    IERC20Metadata[] tokens; // Ordered list of backup collateral ERC20s
}

struct BasketConfig {
    // The ERC20 collateral tokens in the prime (explicitly governance-set) basket
    IERC20Metadata[] tokens;
    // Amount of target units per basket for each prime collateral token. {target/BU}
    mapping(IERC20Metadata => Fix) targetAmts;
    // Backup configurations, per target name.
    mapping(bytes32 => BackupConfig) backups;
}

/**
 * @title BasketHandler
 * @notice Handles the basket configuration, definition, and evolution over time.
 */
contract BasketHandlerP0 is Pausable, Mixin, SettingsHandlerP0, AssetRegistryP0, IBasketHandler {
    using BasketLib for Basket;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using FixLib for Fix;

    BasketConfig private config;

    Basket private basket;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, SettingsHandlerP0, AssetRegistryP0)
    {
        super.init(args);
    }

    /// Force an update for all collateral that could be swapped into the basket
    function forceCollateralUpdates() public override {
        IERC20Metadata[] memory erc20s = registeredERC20s();
        for (uint256 i = 0; i < erc20s.length; i++) {
            if (toAsset(erc20s[i]).isCollateral()) {
                toColl(erc20s[i]).forceUpdates();
            }
        }
    }

    /// Try to ensure a new valid basket
    function ensureValidBasket() public override notPaused {
        forceCollateralUpdates();
        if (worstCollateralStatus() == CollateralStatus.DISABLED) {
            _switchBasket();
        }
    }

    /// Set the prime basket in the basket configuration, in terms of erc20s and target amounts
    /// @param tokens The collateral for the new prime basket
    /// @param targetAmts The target amounts (in) {target/BU} for the new prime basket
    function setPrimeBasket(IERC20Metadata[] memory tokens, Fix[] memory targetAmts)
        public
        override
        onlyOwner
    {
        require(tokens.length == targetAmts.length, "must be same length");
        delete config.tokens;

        for (uint256 i = 0; i < tokens.length; i++) {
            require(toAsset(tokens[i]).isCollateral(), "token is not collateral");

            config.tokens.push(tokens[i]);
            config.targetAmts[tokens[i]] = targetAmts[i];
        }

        emit PrimeBasketSet(tokens, targetAmts);
    }

    /// Set the backup configuration for some target name.
    function setBackupConfig(
        bytes32 targetName,
        uint256 max,
        IERC20Metadata[] memory tokens
    ) public override onlyOwner {
        BackupConfig storage conf = config.backups[targetName];
        conf.max = max;

        delete conf.tokens;
        for (uint256 i = 0; i < tokens.length; i++) {
            conf.tokens.push(tokens[i]);
        }
        emit BackupConfigSet(targetName, max, tokens);
    }

    /// @return true if we registered a change in the underlying reference basket
    function switchBasket() public override onlyOwner returns (bool) {
        return _switchBasket();
    }

    /// @return Whether it holds enough basket units of collateral
    function fullyCapitalized() public view override returns (bool) {
        return basketsHeld().gte(rToken().basketsNeeded());
    }

    function basketNonce() public view override returns (uint256) {
        return basket.nonce;
    }

    /// @return status The maximum CollateralStatus among basket collateral
    function worstCollateralStatus() public view override returns (CollateralStatus status) {
        for (uint256 i = 0; i < basket.tokens.length; i++) {
            IERC20Metadata tok = basket.tokens[i];
            if (!isRegistered(tok) || toColl(tok).status() == CollateralStatus.DISABLED) {
                return CollateralStatus.DISABLED;
            }

            if (uint256(toColl(tok).status()) > uint256(status)) {
                status = toColl(tok).status();
            }
        }
    }

    /// @return total {UoA} An estimate of the total value of all assets held
    function totalAssetValue() public view override returns (Fix total) {
        IERC20Metadata[] memory erc20s = registeredERC20s();
        for (uint256 i = 0; i < erc20s.length; i++) {
            IAsset asset = toAsset(erc20s[i]);
            // Exclude collateral that has defaulted
            if (!asset.isCollateral() || toColl(erc20s[i]).status() != CollateralStatus.DISABLED) {
                uint256 bal = erc20s[i].balanceOf(address(this));

                // {UoA/tok} = {UoA/tok} * {qTok} / {qTok/tok}
                Fix p = asset.price().mulu(bal).shiftLeft(-int8(erc20s[i].decimals()));
                total = total.plus(p);
            }
        }
    }

    // ==== Internal ====

    /// @return {qTok/BU} The quantity of collateral in the basket
    function basketQuantity(IERC20Metadata tok) internal view returns (Fix) {
        if (!isRegistered(tok) || !toAsset(tok).isCollateral()) return FIX_ZERO;

        // {qTok/BU} = {ref/BU} / {ref/tok} * {qTok/tok}
        return basket.refAmts[tok].div(toColl(tok).refPerTok()).shiftLeft(int8(tok.decimals()));
    }

    /// @return p {UoA/BU} The protocol's best guess at what a BU would be priced at in UoA
    function basketPrice() internal view returns (Fix p) {
        for (uint256 i = 0; i < basket.tokens.length; i++) {
            IERC20Metadata tok = basket.tokens[i];
            ICollateral coll = toColl(tok);

            if (isRegistered(tok) && toColl(tok).status() != CollateralStatus.DISABLED) {
                // {UoA/BU} = {UoA/BU} + {UoA/tok} * {qTok/BU} / {qTok/tok}
                p = p.plus(coll.price().mul(basketQuantity(tok)).shiftLeft(-int8(tok.decimals())));
            }
        }
    }

    /// @param amount {BU}
    /// @return tokens The backing collateral tokens
    /// @return quantities {qTok} ERC20 token quantities equal to `amount` BUs
    function basketQuote(Fix amount, RoundingApproach rounding)
        internal
        view
        returns (IERC20Metadata[] memory tokens, uint256[] memory quantities)
    {
        tokens = basket.tokens;
        quantities = new uint256[](basket.tokens.length);
        for (uint256 i = 0; i < basket.tokens.length; i++) {
            // {qTok} = {BU} * {qTok/BU}
            quantities[i] = amount.mul(basketQuantity(tokens[i])).toUint(rounding);
        }
    }

    /// @return {BU} The number of basket units of collateral at an address
    function basketsHeld() internal view returns (Fix) {
        return basketsHeldBy(address(this));
    }

    /// @return baskets {BU} The balance of basket units held by `account`
    function basketsHeldBy(address account) internal view returns (Fix baskets) {
        baskets = FIX_MAX;
        for (uint256 i = 0; i < basket.tokens.length; i++) {
            Fix tokBal = toFix(basket.tokens[i].balanceOf(account)); // {qTok}
            Fix q = basketQuantity(basket.tokens[i]); // {qTok/BU}
            if (q.gt(FIX_ZERO)) {
                // {BU} = {qTok} / {qTok/BU}
                Fix potential = tokBal.div(q);
                if (potential.lt(baskets)) {
                    baskets = potential;
                }
            }
        }
    }

    // These are effectively local variables of _switchBasket. Nothing should use its value
    // from a previous transaction.
    EnumerableSet.Bytes32Set private targetNames;
    Basket private newBasket;

    /// Select and save the next basket, based on the BasketConfig and Collateral statuses
    /// @return whether or not a new basket was derived from templates
    function _switchBasket() private returns (bool) {
        while (targetNames.length() > 0) targetNames.remove(targetNames.at(0));
        newBasket.empty();

        // Count unique targets
        for (uint256 i = 0; i < config.tokens.length; i++) {
            targetNames.add(toColl(config.tokens[i]).targetName());
        }

        // Here, "good" collateral is non-defaulted collateral; any status other than DISABLED
        // goodWeights and totalWeights are in index-correspondence with targetNames

        // {target/BU} total target weight of good, prime collateral with target i
        Fix[] memory goodWeights = new Fix[](targetNames.length());

        // {target/BU} total target weight of all prime collateral with target i
        Fix[] memory totalWeights = new Fix[](targetNames.length());

        // For each prime collateral token:
        for (uint256 i = 0; i < config.tokens.length; i++) {
            IERC20Metadata tok = config.tokens[i];
            if (!isRegistered(tok)) continue; // skip unregistered collateral tokens

            ICollateral coll = toColl(tok);

            // Find coll's targetName index
            uint256 targetIndex;
            for (targetIndex = 0; targetIndex < targetNames.length(); targetIndex++) {
                if (targetNames.at(targetIndex) == coll.targetName()) break;
            }
            assert(targetIndex < targetNames.length());

            // Set basket weights for good, prime collateral,
            // and accumulate the values of goodWeights and targetWeights
            Fix targetWeight = config.targetAmts[tok];
            totalWeights[targetIndex] = totalWeights[targetIndex].plus(targetWeight);

            if (coll.status() != CollateralStatus.DISABLED) {
                goodWeights[targetIndex] = goodWeights[targetIndex].plus(targetWeight);
                newBasket.add(tok, targetWeight.div(coll.targetPerRef()));
            }
        }

        // For each target i, if we still need more weight for target i then try to add the backup
        // basket for target i to make up that weight:
        for (uint256 i = 0; i < targetNames.length(); i++) {
            if (totalWeights[i].lte(goodWeights[i])) continue; // Don't need backup weight

            uint256 size = 0; // backup basket size
            BackupConfig storage backup = config.backups[targetNames.at(i)];

            // Find the backup basket size: min(max, # of good backup collateral)
            for (uint256 j = 0; j < backup.tokens.length; j++) {
                IERC20Metadata tok = backup.tokens[j];
                if (isRegistered(tok) && toColl(tok).status() != CollateralStatus.DISABLED) {
                    size++;
                    if (size >= backup.max) break;
                }
            }

            // If we need backup collateral, but there's no good backup collateral, it's a bad case!
            // Do not set the basket; the protocol will stay issuance-paused until governance acts.
            if (size == 0) return false;

            // Set backup basket weights
            uint256 assigned = 0;
            for (uint256 j = 0; j < backup.tokens.length && assigned < size; j++) {
                IERC20Metadata tok = backup.tokens[j];
                if (isRegistered(tok) && toColl(tok).status() != CollateralStatus.DISABLED) {
                    newBasket.add(tok, totalWeights[i].minus(goodWeights[i]).divu(size));
                    assigned++;
                }
            }
        }

        // If we haven't already given up, then commit the new basket!
        basket.copy(newBasket);

        // Keep records, emit event
        Fix[] memory refAmts = new Fix[](basket.tokens.length);
        for (uint256 i = 0; i < basket.tokens.length; i++) {
            refAmts[i] = basket.refAmts[basket.tokens[i]];
        }
        emit BasketSet(basket.tokens, refAmts);

        return true;
    }
}
