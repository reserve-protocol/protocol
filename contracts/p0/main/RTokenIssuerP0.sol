pragma solidity 0.8.9;
// SPDX-License-Identifier: BlueOak-1.0.0

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/main/SettingsHandlerP0.sol";
import "contracts/p0/main/MoodyP0.sol";
import "contracts/p0/main/VaultHandlerP0.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/Pausable.sol";
import "./MoodyP0.sol";
import "./SettingsHandlerP0.sol";
import "./VaultHandlerP0.sol";
import "./DefaultHandlerP0.sol";

/**
 * @title RTokenIssuer
 * @notice Handles issuance and redemption of RToken.
 */
contract RTokenIssuerP0 is
    Pausable,
    Mixin,
    MoodyP0,
    SettingsHandlerP0,
    VaultHandlerP0,
    DefaultHandlerP0,
    IRTokenIssuer
{
    using SafeERC20 for IERC20;
    using SafeERC20 for IRToken;
    using FixLib for Fix;

    /// Tracks data for an issuance
    /// @param vault The vault the issuance is against
    /// @param amount {qTok} The quantity of RToken the issuance is for
    /// @param amtBUs {qBU} The number of BUs that corresponded to `amount` at time of issuance
    /// @param deposits {qTok} The collateral token quantities that were used to pay for the issuance
    /// @param issuer The account issuing RToken
    /// @param blockAvailableAt {blockNumber} The block number at which the issuance can complete
    /// @param processed false when the issuance is still vesting
    struct SlowIssuance {
        IVault vault;
        uint256 amount; // {qTok}
        uint256 amtBUs; // {qBU}
        uint256[] deposits; // {qTok}, same index as vault basket assets
        address issuer;
        uint256 blockAvailableAt; // {blockNumber}
        bool processed;
    }

    // Slow Issuance
    SlowIssuance[] public issuances;

    /// This modifier runs before every function including redemption, so it should be very safe.
    modifier always() {
        furnace().doBurn();
        ICollateral[] memory hardDefaulting = _checkForHardDefault();
        if (hardDefaulting.length > 0) {
            for (uint256 i = 0; i < hardDefaulting.length; i++) {
                _unapproveCollateral(hardDefaulting[i]);
            }

            _switchVault(_selectNextVault());
            _setMood(Mood.TRADING);
        } else if (!paused) {
            _processSlowIssuance();
        }
        _;
    }

    function init(ConstructorArgs calldata args)
        public
        virtual
        override(Mixin, SettingsHandlerP0, VaultHandlerP0, DefaultHandlerP0)
    {
        super.init(args);
    }

    /// Collects revenue by expanding RToken supply and claiming COMP/AAVE rewards
    function poke() public virtual override(Mixin, DefaultHandlerP0) notPaused notInDoubt always {
        super.poke();
    }

    /// Begin a time-delayed issuance of RToken for basket collateral
    /// @param amount {qTok} The quantity of RToken to issue
    function issue(uint256 amount) public override notPaused notInDoubt always {
        require(amount > 0, "Cannot issue zero");

        uint256 amtBUs = toBUs(amount);

        // During SlowIssuance, RTokens are minted and held by Main until vesting completes
        SlowIssuance memory iss = SlowIssuance({
            vault: vault,
            amount: amount,
            amtBUs: amtBUs,
            deposits: vault.tokenAmounts(amtBUs),
            issuer: _msgSender(),
            blockAvailableAt: _nextIssuanceBlockAvailable(amount),
            processed: false
        });
        issuances.push(iss);

        for (uint256 i = 0; i < iss.vault.size(); i++) {
            IERC20(iss.vault.collateralAt(i).erc20()).safeTransferFrom(iss.issuer, address(this), iss.deposits[i]);
            IERC20(iss.vault.collateralAt(i).erc20()).safeApprove(address(iss.vault), iss.deposits[i]);
        }

        iss.vault.issue(address(this), iss.amtBUs);
        rToken().mint(address(rToken()), amount);
        emit IssuanceStarted(issuances.length - 1, iss.issuer, iss.amount, iss.blockAvailableAt);
    }

    /// Redeem RToken for basket collateral
    /// @param amount {qTok} The quantity {qRToken} of RToken to redeem
    function redeem(uint256 amount) public override always {
        require(amount > 0, "Cannot redeem zero");

        rToken().burn(_msgSender(), amount);
        _oldestVault().redeem(_msgSender(), toBUs(amount));
        emit Redemption(_msgSender(), amount);
    }

    /// @return The token quantities required to issue `amount` RToken.
    function quote(uint256 amount) public view override returns (uint256[] memory) {
        return vault.tokenAmounts(toBUs(amount));
    }

    /// @return erc20s The addresses of the ERC20s backing the RToken
    function backingTokens() public view override returns (address[] memory erc20s) {
        erc20s = new address[](vault.size());
        for (uint256 i = 0; i < vault.size(); i++) {
            erc20s[i] = address(vault.collateralAt(i).erc20());
        }
    }

    // Returns the future block number at which an issuance for *amount* now can complete
    function _nextIssuanceBlockAvailable(uint256 amount) private view returns (uint256) {
        uint256 perBlock = Math.max(
            10_000 * 10**rTokenAsset().decimals(), // lower-bound: 10k whole RToken per block
            toFix(rTokenAsset().erc20().totalSupply()).mul(issuanceRate()).toUint()
        ); // {RToken/block}
        uint256 blockStart = issuances.length == 0 ? block.number : issuances[issuances.length - 1].blockAvailableAt;
        return Math.max(blockStart, block.number) + Math.ceilDiv(amount, perBlock);
    }

    // Processes all slow issuances that have fully vested, or undoes them if the vault has been changed.
    function _processSlowIssuance() internal {
        for (uint256 i = 0; i < issuances.length; i++) {
            if (!issuances[i].processed && issuances[i].vault != vault) {
                rToken().burn(address(rToken()), issuances[i].amount);
                issuances[i].vault.redeem(issuances[i].issuer, issuances[i].amtBUs);
                issuances[i].processed = true;
                emit IssuanceCanceled(i);
            } else if (!issuances[i].processed && issuances[i].blockAvailableAt <= block.number) {
                rToken().withdrawTo(issuances[i].issuer, issuances[i].amount);
                issuances[i].processed = true;
                emit IssuanceCompleted(i);
            }
        }
    }
}
