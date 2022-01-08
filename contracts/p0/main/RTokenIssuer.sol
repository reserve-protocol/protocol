pragma solidity 0.8.9;
// SPDX-License-Identifier: BlueOak-1.0.0

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/main/SettingsHandler.sol";
import "contracts/p0/main/VaultHandler.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/Pausable.sol";
import "./SettingsHandler.sol";
import "./VaultHandler.sol";

/**
 * @title RTokenIssuer
 * @notice Handles issuance and redemption of RToken.
 */
contract RTokenIssuerP0 is Pausable, Mixin, SettingsHandlerP0, VaultHandlerP0, IRTokenIssuer {
    using SafeERC20 for IERC20;
    using SafeERC20 for IRToken;
    using FixLib for Fix;

    /// Tracks data for a SlowIssuance
    /// @param vault The vault the issuance is against
    /// @param amount {qTok} The quantity of RToken the issuance is for
    /// @param amtBUs {qBU} The number of BUs that corresponded to `amount` at time of issuance
    /// @param deposits {qTok} The collateral token quantities that were used to pay for the issuance
    /// @param issuer The account issuing RToken
    /// @param blockAvailableAt {blockNumber} A continuous block number at which the issuance completes
    /// @param processed false when the issuance is still vesting
    struct SlowIssuance {
        IVault vault;
        uint256 amount; // {qTok}
        uint256 amtBUs; // {qBU}
        uint256[] deposits; // {qTok}, same index as vault basket assets
        address issuer;
        Fix blockAvailableAt; // {blockNumber} fractional
        bool processed;
    }

    // Slow Issuance
    SlowIssuance[] public issuances;

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, SettingsHandlerP0, VaultHandlerP0)
    {
        super.init(args);
    }

    /// Process pending issuances on poke
    function poke() public virtual override(Mixin, VaultHandlerP0) notPaused {
        super.poke();
        revenueFurnace().doMelt();
        _processSlowIssuance();
    }

    /// Process pending issuances before parameter update.
    function beforeUpdate() public virtual override(Mixin, VaultHandlerP0) {
        super.beforeUpdate();
        _processSlowIssuance();
    }

    /// Begin a time-delayed issuance of RToken for basket collateral
    /// @param amount {qTok} The quantity of RToken to issue
    function issue(uint256 amount) public override notPaused {
        require(amount > 0, "Cannot issue zero");
        revenueFurnace().doMelt();
        _updateCollateralStatuses();
        _tryEnsureValidVault();
        require(vault().worstCollateralStatus() == CollateralStatus.SOUND, "collateral not sound");

        uint256 amtBUs = toBUs(amount);

        // During SlowIssuance, RTokens are minted and held by Main until vesting completes
        SlowIssuance memory iss = SlowIssuance({
            vault: vault(),
            amount: amount,
            amtBUs: amtBUs,
            deposits: vault().quote(amtBUs, RoundingApproach.CEIL),
            issuer: _msgSender(),
            blockAvailableAt: _nextIssuanceBlockAvailable(amount),
            processed: false
        });
        issuances.push(iss);

        for (uint256 i = 0; i < iss.vault.size(); i++) {
            IERC20 coll = IERC20(iss.vault.collateralAt(i).erc20());
            coll.safeTransferFrom(iss.issuer, address(this), iss.deposits[i]);
            coll.safeApprove(address(iss.vault), iss.deposits[i]);
        }

        iss.vault.issue(address(this), iss.amtBUs);
        rToken().mint(address(this), amount);
        emit IssuanceStarted(issuances.length - 1, iss.issuer, iss.amount, iss.blockAvailableAt);
    }

    /// Redeem RToken for basket collateral
    /// @param amount {qTok} The quantity {qRToken} of RToken to redeem
    function redeem(uint256 amount) public override {
        require(amount > 0, "Cannot redeem zero");
        revenueFurnace().doMelt();

        rToken().burn(_msgSender(), amount);
        uint256 amtBUs = toBUs(amount);
        uint256 amtRedeemed = _redeemFromOldVaults(_msgSender(), amtBUs, true);
        require(amtRedeemed >= amtBUs, "Too few available basket units!");

        emit Redemption(_msgSender(), amount);
    }

    /// @return The token quantities required to issue `amount` RToken.
    function quote(uint256 amount) public view override returns (uint256[] memory) {
        return vault().quote(toBUs(amount), RoundingApproach.CEIL);
    }

    /// @return How much RToken `account` can issue given current holdings
    function maxIssuable(address account) external view override returns (uint256) {
        return fromBUs(vault().maxIssuable(account));
    }

    /// @return erc20s The addresses of the ERC20s backing the RToken
    function backingTokens() public view override returns (address[] memory erc20s) {
        erc20s = new address[](vault().size());
        for (uint256 i = 0; i < vault().size(); i++) {
            erc20s[i] = address(vault().collateralAt(i).erc20());
        }
    }

    // Returns the future block number at which an issuance for *amount* now can complete
    function _nextIssuanceBlockAvailable(uint256 amount) private view returns (Fix) {
        Fix perBlock = fixMax(
            toFixWithShift(1e4, int8(rToken().decimals())), // lower-bound: 10k whole RToken per block
            issuanceRate().mulu(rToken().totalSupply())
        ); // {RToken/block}
        Fix blockStart = toFix(block.number);
        if (
            issuances.length > 0 && issuances[issuances.length - 1].blockAvailableAt.gt(blockStart)
        ) {
            blockStart = issuances[issuances.length - 1].blockAvailableAt;
        }
        return blockStart.plus(divFix(amount, perBlock));
    }

    // Processes all slow issuances that have fully vested, or undoes them if the vault has been changed.
    function _processSlowIssuance() internal {
        for (uint256 i = 0; i < issuances.length; i++) {
            SlowIssuance storage iss = issuances[i];
            if (iss.processed) {
                // Ignore processed issuance
                continue;
            }

            CollateralStatus cs = vault().worstCollateralStatus();
            if (
                (cs == CollateralStatus.SOUND || cs == CollateralStatus.DISABLED) &&
                iss.vault != vault()
            ) {
                // Rollback issuance i
                rToken().burn(address(this), iss.amount);
                iss.vault.redeem(iss.issuer, iss.amtBUs);
                iss.processed = true;
                emit IssuanceCanceled(i);
            } else if (
                cs == CollateralStatus.SOUND && iss.blockAvailableAt.ceil() <= block.number
            ) {
                // Complete issuance i
                iss.vault.transfer(address(rToken()), iss.amtBUs);
                rToken().transfer(iss.issuer, iss.amount);
                iss.processed = true;
                emit IssuanceCompleted(i);
            }
        }
    }
}
