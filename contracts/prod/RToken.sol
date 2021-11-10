// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";

import "./libraries/Basket.sol";
import "../libraries/CompoundMath.sol";
import "./libraries/Token.sol";
import "./interfaces/ITXFee.sol";
import "./interfaces/IRToken.sol";
import "./interfaces/IAtomicExchange.sol";
import "./interfaces/IInsurancePool.sol";
import "./interfaces/ICircuitBreaker.sol";
import "../libraries/CommonErrors.sol";

/**
 * @title RToken
 * @dev An ERC-20 token with built-in rules for price stabilization centered around a basket.
 *
 * RTokens can:
 *    - scale up or down in supply (nearly) completely elastically
 *    - change their backing while maintaining price
 *    - and, recover from collateral defaults through insurance
 *
 * Contract Invariant: Calls to `act` should not impact the state of the system in the long-term,
 * provided that calls to `act` are eventually made.
 *
 */
contract RToken is ERC20VotesUpgradeable, IRToken, OwnableUpgradeable, UUPSUpgradeable {
    using Token for Token.Info;
    using Basket for Basket.Info;

    // A point of reference for percentage values
    /* solhint-disable var-name-mixedcase */
    uint256 public SCALE = 1e18; // weakly immutable

    /* solhint-disable private-vars-leading-underscore*/
    Config internal config;
    /* solhint-disable private-vars-leading-underscore*/
    Basket.Info internal basket;
    /* solhint-disable private-vars-leading-underscore*/
    Token.Info internal rsrToken;

    // SlowMinting data
    struct Minting {
        uint256 amount;
        address account;
    }

    Minting[] public mintings;
    uint256 public currentMinting;

    address public freezer;

    // Private data for last timestamps and last blocks. Not necessary for contract upgrades.
    uint256 private _deployedAt;
    uint256 private _lastExpansion;
    uint256 private _lastInsurancePayment;
    uint256 private _lastMintingBlock;
    uint256 private _lastRebalanceBlock;

    function initialize(
        //address owner_,
        string memory name_,
        string memory symbol_,
        Config memory config_,
        Token.Info[] memory basketTokens_,
        Token.Info memory rsrToken_
    ) external initializer {
        SCALE = 1e18;
        __ERC20_init(name_, symbol_);
        __ERC20Votes_init_unchained();
        __Ownable_init();
        __UUPSUpgradeable_init();
        _checkConfig(config_);
        _checkNewBasket(basketTokens_);
        config = config_;
        basket.size = uint16(basketTokens_.length);
        basket.inflationSinceGenesis = SCALE;
        for (uint16 i = 0; i < basket.size; i++) {
            basket.tokens[i] = basketTokens_[i];
        }
        rsrToken = rsrToken_;

        _deployedAt = block.timestamp;
        _lastExpansion = block.timestamp;
        _lastInsurancePayment = block.timestamp;
        _lastMintingBlock = block.number;
        _lastRebalanceBlock = block.number;
    }

    modifier canTrade() {
        if (rebalancingFrozen()) {
            revert CommonErrors.RebalancingIsFrozen();
        }
        _;
    }

    /// This modifier is run before every issuance, redemption, and act.
    /// It should not run expensive calculations.
    /// It should be idempotent within a block.
    modifier everyBlock() {
        _decayBasket(); // calculates a pure function of block timestamp
        _expandSupply(); // repeated calls will halt early to save gas
        _;
    }

    // ========================= External =============================

    /// Updates the configuration, only callable by owner.
    function updateConfig(Config memory newConfig) external override onlyOwner {
        _checkConfig(newConfig);
        emit ConfigUpdated();
        config = newConfig;
    }

    /// Updates the basket, only callable by owner.
    function updateBasket(Token.Info[] memory newTokens) external override onlyOwner {
        _checkNewBasket(newTokens);
        emit BasketUpdated(basket.size, uint16(newTokens.length));
        basket.setTokens(newTokens);
        basket.inflationSinceGenesis = SCALE;
    }

    /// Updates priceInRToken for the token at index i, only callable by owner.
    function setBasketTokenPriceInRToken(uint16 i, uint256 priceInRToken) external override onlyOwner {
        basket.tokens[i].priceInRToken = priceInRToken;
    }

    /// Updates priceInRToken for the RSR token, only callable by owner.
    function setRSRPriceInRToken(uint256 priceInRToken) external override onlyOwner {
        rsrToken.priceInRToken = priceInRToken;
    }

    /// Callable by anyone, runs the block updates and then a bunch of expensive operations.
    /// The expectation is that it is called by arbitrageurs who can be asked to pay the gas
    /// for other important RToken operations such as settling mintings and rebalance rebalancing.
    function act() external override everyBlock {
        _trySweepRevenue();
        _tryProcessMintings();
        _rebalance();
    }

    /// Anyone can call this function to issue RToken to themselves.
    /// The approvals for the collateral tokens must be made in advance.
    /// Mintings are slow and take time to setle.
    function issue(uint256 amount) external override everyBlock {
        if (config.circuitBreaker.paused()) {
            revert CommonErrors.CircuitPaused();
        }

        if (amount <= config.minMintingSize) {
            revert CommonErrors.MintingAmountTooLow();
        }

        if (basket.size == 0) {
            revert CommonErrors.EmptyBasket();
        }

        uint256[] memory amounts = issueAmounts(amount);
        for (uint16 i = 0; i < basket.size; i++) {
            basket.tokens[i].safeTransferFrom(_msgSender(), address(this), amounts[i]);
        }

        // puts minting on the queue
        _startSlowMinting(_msgSender(), amount);
    }

    /// Anyone can call this function to immediately redeem RToken for collateral tokens.
    function redeem(uint256 amount) external override everyBlock {
        if (amount == 0) {
            revert CommonErrors.RedeemAmountCannotBeZero();
        }

        if (basket.size == 0) {
            revert CommonErrors.EmptyBasket();
        }

        uint256[] memory amounts = redemptionAmounts(amount);
        _burn(_msgSender(), amount);
        for (uint16 i = 0; i < basket.size; i++) {
            basket.tokens[i].safeTransfer(_msgSender(), amounts[i]);
        }

        emit Redemption(_msgSender(), amount);
    }

    /// Freezes rebalancing by locking a large amount of RSR.
    /// Anyone can freeze rebalancing, even if it's already frozen.
    function freezeRebalancing() external override {
        if (rebalancingFrozen()) {
            rsrToken.safeTransfer(freezer, config.rebalancingFreezeCost);
        }

        rsrToken.safeTransferFrom(_msgSender(), address(this), config.rebalancingFreezeCost);
        freezer = _msgSender();
        emit RebalancingFrozen(_msgSender());
    }

    /// Unfreezes rebalancing. Only callable by the freezer.
    function unfreezeRebalancing() external override {
        if (!rebalancingFrozen()) {
            revert CommonErrors.RebalancingAlreadyUnfrozen();
        }

        if (_msgSender() != freezer) {
            revert CommonErrors.Unauthorized();
        }

        rsrToken.safeTransfer(freezer, config.rebalancingFreezeCost);
        freezer = address(0);
        emit RebalancingUnfrozen(_msgSender());
    }

    /// A light wrapper to prevent sends to contract address.
    function transfer(address recipient, uint256 amount) public override returns (bool) {
        if (recipient == address(this)) {
            revert CommonErrors.TransferToContractAddress();
        }

        return super.transfer(recipient, amount);
    }

    /// A light wrapper to prevent sends to contract address.
    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public override returns (bool) {
        if (recipient == address(this)) {
            revert CommonErrors.TransferToContractAddress();
        }
        return super.transferFrom(sender, recipient, amount);
    }

    // =========================== Views =================================

    /// Returns whether rebalancing is currently frozen or not.
    function rebalancingFrozen() public view override returns (bool) {
        return freezer != address(0);
    }

    /// Returns the quantities necessary to issue a quantity of RToken.
    /// Does not decay the basket quantities.
    function issueAmounts(uint256 amount) public view override returns (uint256[] memory amounts) {
        return basket.issueAmounts(amount, SCALE, config.spread, decimals());
    }

    /// Returns the collateral token quantities given by a redemption of a quantity of RToken.
    /// Does not decay the basket quantities.
    function redemptionAmounts(uint256 amount) public view override returns (uint256[] memory amounts) {
        return basket.redemptionAmounts(amount, SCALE, decimals(), totalSupply());
    }

    /// Returns the fee would pay to transfer *amount*
    function calculateFee(
        address from,
        address to,
        uint256 amount
    ) public view override returns (uint256) {
        if (address(config.txFeeCalculator) == address(0)) {
            return 0;
        }

        return MathUpgradeable.min(amount, config.txFeeCalculator.calculateFee(from, to, amount));
    }

    // =========================== Getters =================================

    function stakingDepositDelay() external view override returns (uint256) {
        return config.stakingDepositDelay;
    }

    function stakingWithdrawalDelay() external view override returns (uint256) {
        return config.stakingWithdrawalDelay;
    }

    function insurancePool() external view override returns (address) {
        return address(config.insurancePool);
    }

    function basketSize() external view override returns (uint16) {
        return basket.size;
    }

    function basketToken(uint16 i) external view override returns (Token.Info memory) {
        return basket.tokens[i];
    }

    function rsr() external view override returns (Token.Info memory) {
        return rsrToken;
    }

    // =========================== Internal =================================

    /// Reverts if any of the tokens in the list are set incorrectly.
    function _checkNewBasket(Token.Info[] memory tokens) internal view {
        if (tokens.length > type(uint16).max) {
            revert CommonErrors.BasketTooBig();
        }
        for (uint16 i = 0; i < tokens.length; i++) {
            if (tokens[i].slippageTolerance > SCALE) {
                revert CommonErrors.SlippageToleranceTooBig();
            }

            if (tokens[i].maxTrade == 0 || tokens[i].rateLimit == 0) {
                revert CommonErrors.UninitializedTokens();
            }
        }
    }

    /// Reverts if any of the config values are set incorrectly.
    function _checkConfig(Config memory c) internal view {
        if (c.expansionPerSecond > SCALE) {
            revert CommonErrors.SupplyExpansionTooLarge();
        }

        if (c.expenditureFactor > SCALE) {
            revert CommonErrors.ExpenditureFactorTooLarge();
        }

        if (c.spread > SCALE) {
            revert CommonErrors.SpreadTooLarge();
        }
    }

    /// Sets inflationSinceGenesis based on a compounding exponential calculation.
    function _decayBasket() internal {
        // Discrete compounding on a per-second basis
        basket.inflationSinceGenesis = CompoundMath.compound(
            SCALE,
            config.expansionPerSecond,
            block.timestamp - _deployedAt
        );
    }

    /// Expands the RToken supply based on the time since last supply expansion.
    function _expandSupply() internal {
        // Discrete compounding on a per-second basis
        uint256 amount = totalSupply() -
            (totalSupply() * SCALE) /
            CompoundMath.compound(SCALE, config.expansionPerSecond, block.timestamp - _lastExpansion);

        _lastExpansion = block.timestamp;
        if (amount == 0) {
            return;
        }

        // Mint to protocol fund
        if (config.expenditureFactor > 0) {
            uint256 e = (amount * config.expenditureFactor) / SCALE;
            _mint(address(config.protocolFund), e);
        }

        // Mint to self
        if (config.expenditureFactor < SCALE) {
            uint256 p = (amount * (SCALE - config.expenditureFactor)) / SCALE;
            _mint(address(this), p);
        }
    }

    /// Sweeps revenue payments from self to insurance pool if it has been long enough.
    function _trySweepRevenue() internal {
        if (_lastInsurancePayment + config.insurancePaymentPeriod < block.timestamp) {
            _lastInsurancePayment = block.timestamp;
            uint256 bal = balanceOf(address(this));
            _approve(address(this), address(config.insurancePool), bal);
            config.insurancePool.makeInsurancePayment(bal);
        }
    }

    /// Tries to process up to a fixed number of mintings.
    function _tryProcessMintings() internal {
        if (!config.circuitBreaker.paused()) {
            uint256 start = currentMinting;
            uint256 blocksSince = block.number - _lastMintingBlock;
            uint256 issuanceAmount = config.issuanceRate;
            Minting storage m;
            while (currentMinting < mintings.length && currentMinting < start + 1000) {
                // TODO: Tune the +1000 maximum.
                m = mintings[currentMinting];

                // We should break if the next minting is too big to allow more blocks to pass
                if (m.amount > issuanceAmount * (blocksSince)) {
                    break;
                }
                // We should also break if the max allowed supply is exceeded
                if ((totalSupply() + m.amount) > config.maxSupply) {
                    emit MaxSupplyExceeded();
                    break;
                }

                _mint(m.account, m.amount);
                emit SlowMintingComplete(m.account, m.amount);

                // ==== Overhead ====

                if (m.amount >= issuanceAmount) {
                    issuanceAmount = 0;
                } else {
                    issuanceAmount -= m.amount;
                }

                uint256 blocksUsed = m.amount / config.issuanceRate;
                if (blocksUsed * config.issuanceRate > m.amount) {
                    blocksUsed = blocksUsed + 1;
                }
                blocksSince = blocksSince - blocksUsed;

                delete mintings[currentMinting]; // gas saving?
                currentMinting++;
            }

            // Update _lastMintingBlock if tokens are minted.
            if (currentMinting > start) {
                _lastMintingBlock = block.number;
            }
        }
    }

    /// Trades a single token against the DEXRouter with per-block rate limiting.
    function _rebalance() internal {
        uint256 numBlocks = block.number - _lastRebalanceBlock;
        _lastRebalanceBlock = block.number;
        if (numBlocks == 0 || rebalancingFrozen()) {
            return;
        }

        (int32 deficitIndex, int32 surplusIndex) = basket.mostUndercollateralizedAndMostOverCollateralized(
            SCALE,
            decimals(),
            totalSupply()
        );

        // Three cases:
        // 1. There is excess of collateral A and deficit of collateral B. Trade A for B.
        // 2. There is deficit of collateral A and no excesses. Trade RSR for A.
        // 3. There is excess of collateral A and no deficits. Trade A for RSR.
        if (deficitIndex >= 0 && surplusIndex >= 0) {
            // Sell as much excess collateral as possible for missing collateral.
            _calculateBuyAmountAndTrade(
                basket.tokens[uint16(uint32(deficitIndex))],
                basket.tokens[uint16(uint32(surplusIndex))],
                uint16(uint32(surplusIndex)),
                numBlocks,
                decimals(),
                totalSupply()
            );
        } else if (deficitIndex >= 0) {
            // Seize RSR from the insurance pool and sell it for missing collateral.
            Token.Info storage lowToken = basket.tokens[uint16(uint32(deficitIndex))];
            uint256 sell = MathUpgradeable.min(numBlocks * rsrToken.rateLimit, rsrToken.maxTrade);
            sell = MathUpgradeable.min(sell, rsrToken.getBalance(address(config.insurancePool)));
            rsrToken.safeTransferFrom(address(config.insurancePool), address(this), sell);

            uint256 minBuy = (sell * lowToken.priceInRToken) / rsrToken.priceInRToken;
            minBuy = (minBuy * MathUpgradeable.min(lowToken.slippageTolerance, rsrToken.slippageTolerance)) / SCALE;
            _tradeWithFixedSellAmount(rsrToken, lowToken, sell, minBuy);

            // TODO: Maybe remove, turn into require, or leave if necessary.
            // Clean up any leftover RSR
            if (rsrToken.myBalance() > 0) {
                rsrToken.safeTransfer(address(config.insurancePool), rsrToken.myBalance());
            }
        } else if (surplusIndex >= 0) {
            // Sell as much excess collateral as possible for RSR.
            _calculateBuyAmountAndTrade(
                rsrToken,
                basket.tokens[uint16(uint32(surplusIndex))],
                uint16(uint32(surplusIndex)),
                numBlocks,
                decimals(),
                totalSupply()
            );
        }
    }

    /// Starts a time-delayed minting.
    function _startSlowMinting(address account, uint256 amount) internal {
        if (account == address(0)) {
            revert CommonErrors.MintToZeroAddressNotAllowed();
        }
        if (amount == 0) {
            revert CommonErrors.CannotMintZero();
        }

        Minting memory m = Minting(amount, account);
        mintings.push(m);

        // Update _lastMintingBlock if this is the only item in queue
        if (mintings.length == currentMinting + 1) {
            _lastMintingBlock = block.number;
        }
        emit SlowMintingInitiated(account, amount);
    }

    /// Calculates the selling and buying amount for a fixed sell trade.
    function _calculateBuyAmountAndTrade(
        Token.Info storage buying,
        Token.Info storage selling,
        uint16 sellingIndex,
        uint256 numBlocks,
        uint8 decimals,
        uint256 totalSupply
    ) internal {
        uint256 sell = MathUpgradeable.min(numBlocks * selling.rateLimit, selling.maxTrade);
        sell = MathUpgradeable.min(
            sell,
            selling.myBalance() - (totalSupply * basket.weight(SCALE, sellingIndex)) / 10**decimals
        );

        uint256 minBuy = (MathUpgradeable.min(buying.slippageTolerance, selling.slippageTolerance) *
            sell *
            buying.priceInRToken) / (selling.priceInRToken * SCALE);
        _tradeWithFixedSellAmount(selling, buying, sell, minBuy);
    }

    /// Performs the trade interaction with the DEXRouter and checks for bad outcomes.
    function _tradeWithFixedSellAmount(
        Token.Info storage sellToken,
        Token.Info storage buyToken,
        uint256 sellAmount,
        uint256 minBuyAmount
    ) internal {
        uint256 initialSellBal = sellToken.myBalance();
        uint256 initialBuyBal = buyToken.myBalance();
        sellToken.safeApprove(address(config.exchange), sellAmount);
        config.exchange.tradeFixedSell(sellToken.tokenAddress, buyToken.tokenAddress, sellAmount, minBuyAmount);

        // TODO: Maybe exact equality is too much to ask? Discover during tests.
        if (sellToken.myBalance() - initialSellBal != sellAmount) {
            revert CommonErrors.BadSell();
        }
        if (buyToken.myBalance() - initialBuyBal < minBuyAmount) {
            revert CommonErrors.BadBuy();
        }
        sellToken.safeApprove(address(config.exchange), 0);
    }

    /**
     * @dev Hook that is called before any transfer of tokens. This includes
     * minting and burning.
     *
     * Calling conditions:
     *
     * - when `from` and `to` are both non-zero, `amount` of ``from``'s tokens
     * will be to transferred to `to`.
     * - when `from` is zero, `amount` tokens will be minted for `to`.
     * - when `to` is zero, `amount` of ``from``'s tokens will be burned.
     * - `from` and `to` are never both zero.
     *
     * Implements an optional tx fee on transfers, capped.
     * The fee is *in addition* to the transfer amount.
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        if (from != address(0) && to != address(0) && address(config.txFeeCalculator) != address(0)) {
            uint256 fee = MathUpgradeable.min(amount, config.txFeeCalculator.calculateFee(from, to, amount));

            // Cheeky way of doing the fee without needing access to underlying _balances array
            _burn(from, fee);
            _mint(address(this), fee);
        }
    }

    /// UUPSUpgradeable pattern that encodes under what conditions this proxy implementation can be upgraded.
    /* solhint-disable no-empty-blocks */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
