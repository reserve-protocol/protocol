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
    Fix internal _prevBasketRate; // {USD/qBU} redemption value of the basket in fiatcoins last update

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
        return _baseFactor().mulu(amount).toUint();
    }

    /// {qBU} -> {qRTok}
    function fromBUs(uint256 amtBUs) public view override returns (uint256) {
        return divFix(amtBUs, _baseFactor()).toUint();
    }

    // ==== Internal ====

    function _switchVault(IVault vault_) internal {
        beforeUpdate();
        emit NewVaultSet(address(vault()), address(vault_));
        vaults.push(vault_);

        // TODO: Hmm I don't love this, but we need to cause _processSlowMintings in RTokenIssuer
        beforeUpdate();
    }

    /// @return {qRTok/qBU} The conversion rate from BUs to RTokens,
    /// 1.0 if the total rtoken supply is 0
    /// Else, (melting factor) / (basket dilution factor)
    function _baseFactor() internal view returns (Fix) {
        return
            rToken().totalSupply() == 0 ? FIX_ONE : _meltingFactor().div(_basketDilutionFactor());
    }

    /* As the basketRate increases, the basketDilutionFactor increases at a proportional rate.
     * for two times t0 < t1 when the rTokenCut() doesn't change, we have:
     * (basketDiluationFactor at t1) - (basketDilutionFactor at t0) = rTokenCut() * ((basketRate at t1) - (basketRate at t0))
     */
    /// @return {qBU/qRTok) the basket dilution factor
    function _basketDilutionFactor() internal view returns (Fix) {
        // {USD/qBU}
        Fix currentRate = vault().basketRate();

        // Assumption: Defi redemption rates are monotonically increasing
        // {USD/qBU}
        Fix delta = currentRate.minus(_prevBasketRate);

        // r = p2 / (p1 + (p2-p1) * (rTokenCut))
        Fix r = currentRate.div(_prevBasketRate.plus(delta.mul(rTokenCut())));
        Fix dilutionFactor = _historicalBasketDilution.mul(r);
        assert(dilutionFactor.neq(FIX_ZERO));
        return dilutionFactor;
    }

    /// @return {none} Numerator of the base factor
    function _meltingFactor() internal view returns (Fix) {
        Fix supply = toFix(rToken().totalSupply()); // {qRTok}
        Fix melted = toFix(rToken().totalMelted()); // {qRTok}
        return supply.eq(FIX_ZERO) ? FIX_ONE : supply.plus(melted).div(supply);
    }

    /// Redeems up to `amtBUs` basket units from all past vaults.
    /// @return redeemedBUs How many BUs were actually redeemed
    function _redeemFromOldVaults(address recipient, uint256 maxBUs)
        internal
        returns (uint256 redeemedBUs)
    {
        for (uint256 i = 0; i + 1 < vaults.length && redeemedBUs < maxBUs; i++) {
            redeemedBUs += _redeemFrom(vaults[i], recipient, maxBUs - redeemedBUs);
        }
    }

    /// @return toRedeem How many BUs were redeemed
    function _redeemFrom(
        IVault vault_,
        address recipient,
        uint256 maxToRedeem
    ) internal returns (uint256 toRedeem) {
        toRedeem = Math.min(vault_.basketUnits(address(this)), maxToRedeem);
        if (toRedeem > 0) {
            vault_.redeem(recipient, toRedeem);
        }
    }
}
