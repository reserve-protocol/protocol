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
import "contracts/libraries/Fixed.sol";
import "./SettingsHandlerP0.sol";

/**
 * @title VaultHandler
 * @notice Handles the use of vaults and their associated basket units (BUs), including the tracking
 *    of the base rate, the exchange rate between RToken and BUs.
 */
contract VaultHandlerP0 is Ownable, Mixin, SettingsHandlerP0, IVaultHandler {
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

    Fix internal _f; // The Revenue Factor: the fraction of revenue that goes to stakers

    IVault public override vault;
    IVault[] public pastVaults;

    function init(ConstructorArgs calldata args) public virtual override(Mixin, SettingsHandlerP0) {
        super.init(args);
        vault = args.vault;
        _prevBasketRate = args.vault.basketRate();
        _historicalBasketDilution = FIX_ONE;
    }

    function switchVault(IVault vault_) external override onlyOwner {
        _switchVault(vault_);
    }

    function setF(Fix newF) external override onlyOwner {
        emit ParamFSet(_f, newF);
        _f = newF;
    }

    /// @return Whether the vault is fully capitalized
    function fullyCapitalized() public view override returns (bool) {
        return fromBUs(vault.basketUnits(address(this))) >= rToken().totalSupply();
    }

    /// {qRTok} -> {qBU}
    function toBUs(uint256 amount) public view override returns (uint256) {
        if (rToken().totalSupply() == 0) {
            return amount;
        }

        // (_meltingFactor() / _basketDilutionFactor()) * amtBUs
        return _baseFactor().mulu(amount).toUint();
    }

    /// {qBU} -> {qRTok}
    // solhint-disable-next-line func-param-name-mixedcase
    function fromBUs(uint256 amtBUs) public view override returns (uint256) {
        if (rToken().totalSupply() == 0) {
            return amtBUs;
        }

        // (_basketDilutionFactor() / _meltingFactor()) * amount
        return toFix(amtBUs).div(_baseFactor()).toUint();
    }

    // ==== Internal ====

    /// @return {qRTok/qBU} The base factor
    function _baseFactor() internal view returns (Fix) {
        return _meltingFactor().div(_basketDilutionFactor());
    }

    function _switchVault(IVault vault_) internal {
        pastVaults.push(vault);
        emit NewVaultSet(address(vault), address(vault_));
        vault = vault_;

        // Accumulate the basket dilution factor to enable correct forward accounting
        _accumulate();
    }

    /// @return {none) Denominator of the base factor
    function _basketDilutionFactor() internal view returns (Fix) {
        Fix currentRate = vault.basketRate();

        // Assumption: Defi redemption rates are monotonically increasing
        Fix delta = currentRate.minus(_prevBasketRate);

        // r = p2 / (p1 + (p2-p1) * (1-f))
        Fix r = currentRate.div(_prevBasketRate.plus(delta.mul(FIX_ONE.minus(_config.f))));
        Fix dilutionFactor = _historicalBasketDilution.mul(r);
        require(dilutionFactor.gt(FIX_ZERO), "dilutionFactor cannot be zero");
        return dilutionFactor;
    }

    /// @return {none} Numerator of the base factor
    function _meltingFactor() internal view returns (Fix) {
        Fix totalSupply = toFix(rToken().totalSupply()); // {RTok}
        Fix totalBurnt = toFix(furnace.totalBurnt()); // {RTok}
        if (totalSupply.eq(FIX_ZERO)) {
            return FIX_ONE;
        }

        // (totalSupply + totalBurnt) / totalSupply
        return totalSupply.plus(totalBurnt).div(totalSupply);
    }

    /// Returns the oldest vault that contains nonzero BUs.
    /// Note that this will pass over vaults with uneven holdings, it does not necessarily mean the vault
    /// contains no collateral._oldestVault()
    function _oldestVault() internal view returns (IVault) {
        for (uint256 i = 0; i < pastVaults.length; i++) {
            if (pastVaults[i].basketUnits(address(this)) > 0) {
                return pastVaults[i];
            }
        }
        return vault;
    }

    /// Accumulates current metrics into historical metrics
    function _accumulate() internal {
        _historicalBasketDilution = _basketDilutionFactor();
        _prevBasketRate = vault.basketRate();
    }
}
