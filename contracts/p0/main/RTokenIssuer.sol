pragma solidity 0.8.9;
// SPDX-License-Identifier: BlueOak-1.0.0

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/main/SettingsHandler.sol";
import "contracts/p0/main/BasketHandler.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/libraries/Basket.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/Pausable.sol";
import "./SettingsHandler.sol";
import "./BasketHandler.sol";

/**
 * @title RTokenIssuer
 * @notice Handles issuance and redemption of RToken.
 */
contract RTokenIssuerP0 is Pausable, Mixin, SettingsHandlerP0, BasketHandlerP0, IRTokenIssuer {
    using BasketLib for Basket;
    using SafeERC20 for IERC20Metadata;
    using SafeERC20 for IRToken;
    using FixLib for Fix;

    /// Tracks data for a SlowIssuance
    /// @param blockStartedAt The block number the issuance was started in, non-fractional
    /// @param amount {qTok} The quantity of RToken the issuance is for
    /// @param amtBUs {qBU} The number of BUs that corresponded to `amount` at time of issuance
    /// @param deposits {qTok} The collateral token quantities that paid for the issuance
    /// @param issuer The account issuing RToken
    /// @param blockAvailableAt {blockNumber} The block number when the issuance completes
    ///   May be a fraction; the issuance is available when block.number >= blackAvailableAt
    /// @param processed false when the issuance is still vesting
    struct SlowIssuance {
        uint256 blockStartedAt;
        uint256 amount; // {qRTok}
        address[] erc20s;
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
        override(Mixin, SettingsHandlerP0, BasketHandlerP0)
    {
        super.init(args);
    }

    /// Process pending issuances on poke
    function poke() public virtual override(Mixin, BasketHandlerP0) notPaused {
        super.poke();
        revenueFurnace().doMelt();
        _processSlowIssuance();
    }

    /// Begin a time-delayed issuance of RToken for basket collateral
    /// @param amount {qTok} The quantity of RToken to issue
    function issue(uint256 amount) public override notPaused {
        require(amount > 0, "Cannot issue zero");
        revenueFurnace().doMelt();
        _updateBasket();
        require(_worstCollateralStatus() == CollateralStatus.SOUND, "collateral not sound");

        uint256[] memory amounts = _basket.deposit(_msgSender(), _toBUs(amount));

        // During SlowIssuance, RTokens are minted and held by Main until vesting completes
        SlowIssuance memory iss = SlowIssuance({
            blockStartedAt: block.number,
            amount: amount,
            erc20s: _basket.backingERC20s(),
            deposits: amounts,
            issuer: _msgSender(),
            blockAvailableAt: _nextIssuanceBlockAvailable(amount),
            processed: false
        });
        issuances.push(iss);
        rToken().mint(address(rToken()), amount);
        emit IssuanceStarted(issuances.length - 1, iss.issuer, iss.amount, iss.blockAvailableAt);
    }

    /// Redeem RToken for basket collateral
    /// @param amount {qTok} The quantity {qRToken} of RToken to redeem
    function redeem(uint256 amount) public override {
        require(amount > 0, "Cannot redeem zero");
        revenueFurnace().doMelt();

        rToken().burn(_msgSender(), amount);
        _basket.withdraw(_msgSender(), _toBUs(amount));
        emit Redemption(_msgSender(), amount);
    }

    /// @return quantities {qTok} The token quantities required to issue `amount` RToken.
    function quote(uint256 amount) public view override returns (uint256[] memory quantities) {
        Fix amtBUs = _toBUs(amount);
        quantities = new uint256[](_basket.size);
        for (uint256 i = 0; i < _basket.size; i++) {
            // {qTok} = {BU} * {qTok/BU}
            quantities[i] = amtBUs.mul(_basket.quantity(_basket.collateral[i])).ceil();
        }
    }

    /// @return How much RToken `account` can issue given current holdings
    function maxIssuable(address account) external view override returns (uint256) {
        return _fromBUs(_basket.maxIssuableBUs(account));
    }

    /// @return erc20s The addresses of the ERC20s backing the RToken
    function backingTokens() public view override returns (address[] memory erc20s) {
        return _basket.backingERC20s();
    }

    // Returns the future block number at which an issuance for *amount* now can complete
    function _nextIssuanceBlockAvailable(uint256 amount) private view returns (Fix) {
        Fix perBlock = fixMax(
            toFixWithShift(1e4, int8(rToken().decimals())), // at least 10k RTokens per block
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

    // Process slow issuances:
    // - undoes any issuances that was started before the basket was last set
    // - enacts any other issuances that are fully vested
    function _processSlowIssuance() internal {
        if (!fullyCapitalized()) {
            return;
        }

        bool backingIsSound = _worstCollateralStatus() == CollateralStatus.SOUND;
        for (uint256 i = 0; i < issuances.length; i++) {
            SlowIssuance storage iss = issuances[i];
            if (iss.processed) {
                // Ignore processed issuance
                continue;
            }

            if (iss.blockStartedAt <= _blockBasketLastUpdated) {
                // Rollback issuance i
                rToken().burn(address(rToken()), iss.amount);
                for (uint256 j = 0; j < iss.erc20s.length; i++) {
                    IERC20Metadata(iss.erc20s[j]).safeTransfer(iss.issuer, iss.deposits[j]);
                }
                iss.processed = true;
                emit IssuanceCanceled(i);
            } else if (backingIsSound) {
                // Complete issuance i
                rToken().withdraw(iss.issuer, iss.amount);
                iss.processed = true;
                emit IssuanceCompleted(i);
            }
        }
    }
}
