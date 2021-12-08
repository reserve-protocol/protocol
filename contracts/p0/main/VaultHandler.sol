// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IVault.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/main/RevenueDistributor.sol";
import "contracts/libraries/Fixed.sol";
import "./SettingsHandler.sol";

/**
 * @title VaultHandler
 * @notice Handles the use of vaults and their associated basket units (BUs), including the tracking
 *    of the base rate, the exchange rate between RToken and BUs.
 */
contract VaultHandlerP0 is Ownable, Mixin, SettingsHandlerP0, RevenueDistributorP0, IVaultHandler {
    using SafeERC20 for IERC20;
    using FixLib for Fix;

    // ECONOMICS
    //
    // base factor = exchange rate between Vault BUs and RTokens
    // base factor = b = _meltingFactor() / _basketDilutionFactor()
    // <RToken> = b * <Basket Unit Vector>
    // Fully capitalized: #RTokens <= #BUs / b

    Fix internal _historicalBasketDilution; // the product of all historical basket dilutions
    Fix internal _prevBasketRate; // redemption value of the basket in fiatcoins last update

    IVault[] public override vaults;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, SettingsHandlerP0, RevenueDistributorP0)
    {
        super.init(args);
        vaults.push(args.vault);

        // Check if vault has unapproved collateral
        if (!vault().containsOnly(args.approvedCollateral)) {
            revert CommonErrors.UnapprovedCollateral();
        }

        _prevBasketRate = args.vault.basketRate();
        _historicalBasketDilution = FIX_ONE;
    }

    /// Folds current metrics into historical metrics
    function beforeUpdate()
        public
        virtual
        override(Mixin, SettingsHandlerP0, RevenueDistributorP0)
    {
        super.beforeUpdate();
        _historicalBasketDilution = _basketDilutionFactor();
        _prevBasketRate = vault().basketRate();
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
        return fromBUs(vault().basketUnits(address(this))) >= rToken().totalSupply();
    }

    /// {qRTok} -> {qBU}
    function toBUs(uint256 amount) public view override returns (uint256) {
        if (rToken().totalSupply() == 0) {
            return amount;
        }

        // (_meltingFactor() / _basketDilutionFactor()) * amtBUs
        return _baseFactor().mulu(amount).toRoundUint();
    }

    /// {qBU} -> {qRTok}
    // solhint-disable-next-line func-param-name-mixedcase
    function fromBUs(uint256 amtBUs) public view override returns (uint256) {
        if (rToken().totalSupply() == 0) {
            return amtBUs;
        }

        // (_basketDilutionFactor() / _meltingFactor()) * amount
        return toFix(amtBUs).div(_baseFactor()).toRoundUint();
    }

    // ==== Internal ====

    /// @return {qRTok/qBU} The base factor
    function _baseFactor() internal view returns (Fix) {
        return _meltingFactor().div(_basketDilutionFactor());
    }

    function _switchVault(IVault vault_) internal {
        beforeUpdate();
        emit NewVaultSet(address(vault()), address(vault_));
        vaults.push(vault_);
        beforeUpdate();
    }

    /// @return {none) Denominator of the base factor
    function _basketDilutionFactor() internal view returns (Fix) {
        Fix currentRate = vault().basketRate();

        // Assumption: Defi redemption rates are monotonically increasing
        Fix delta = currentRate.minus(_prevBasketRate);

        // here, in order to deal with changes to the rTokenCut coming from RevenueDistributor.
        // r = p2 / (p1 + (p2-p1) * (rTokenCut))
        Fix r = currentRate.div(_prevBasketRate.plus(delta.mul(rTokenCut())));
        Fix dilutionFactor = _historicalBasketDilution.mul(r);
        require(dilutionFactor.gt(FIX_ZERO), "dilutionFactor cannot be zero");
        return dilutionFactor;
    }

    /// @return {none} Numerator of the base factor
    function _meltingFactor() internal view returns (Fix) {
        Fix totalSupply = toFix(rToken().totalSupply()); // {qRTok}
        Fix totalBurnt = toFix(rToken().totalMelted()); // {qRTok}
        if (totalSupply.eq(FIX_ZERO)) {
            return FIX_ONE;
        }

        // (totalSupply + totalBurnt) / totalSupply
        return totalSupply.plus(totalBurnt).div(totalSupply);
    }

    /// Redeems up to `amtBUs` basket units from all past vaults.
    /// @return crackedBUs How many BUs were actually cracked
    function _redeemFromOldVaults(address recipient, uint256 maxBUs)
        internal
        returns (uint256 crackedBUs)
    {
        for (uint256 i = 0; i + 1 < vaults.length && crackedBUs < maxBUs; i++) {
            uint256 toCrack = Math.min(vaults[i].basketUnits(address(this)), maxBUs - crackedBUs);
            if (toCrack > 0) {
                vaults[i].redeem(recipient, toCrack);
                crackedBUs += toCrack;
            }
        }
    }
}
