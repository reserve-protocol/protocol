// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";

import "./libraries/Basket.sol";
import "./libraries/Token.sol";
import "./interfaces/ITXFee.sol";
import "./interfaces/IRToken.sol";
import "./interfaces/IAtomicExchange.sol";
import "./interfaces/IInsurancePool.sol";
import "./interfaces/ICircuitBreaker.sol";

/**
 * @title RToken
 * @dev An ERC-20 token with built-in rules for price stabilization centered around a basket.
 *
 * RTokens can:
 *    - scale up or down in supply (nearly) completely elastically
 *    - change their backing while maintaining price
 *    - and, recover from collateral defaults through insurance
 *
 */
contract RToken is ERC20VotesUpgradeable, IRToken, OwnableUpgradeable, UUPSUpgradeable {
    using Token for Token.Info;
    using Basket for Basket.Info;

    // Cannot have immutables in upgradeable contracts, but this is immutable after initialization
    uint256 public SCALE = 1e18;

    Config config;
    Basket.Info basket;
    Token.Info rsrToken;

    /// SlowMinting data
    struct Minting {
        uint256 amount;
        address account;
    }

    Minting[] public mintings;
    uint256 public currentMinting;

    address public freezer;

    /// Private
    uint256 private _deployedAt;
    uint256 private _lastTimestamp;
    uint256 private _lastBlock;


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
        config = config_;
        basket.size = uint16(basketTokens_.length);
        for (uint16 i = 0; i < basket.size; i++) {
            basket.tokens[i] = basketTokens_[i];
        }
        rsrToken = rsrToken_;

        // _transferOwnership(owner_);
        _deployedAt = block.timestamp;
        _lastTimestamp = block.timestamp;
        _lastBlock = block.number;
        _updateBasket();
    }

    modifier canTrade() {
        require(!tradingFrozen(), "DEX interactions are frozen, but you can transfer or redeem");
        _;
    }

    /// These sub-functions should all be idempotent within a block
    modifier everyBlock() {

        // decrease basket quantities based on blocknumber
        _updateBasket();

        // SlowMintingERC20 update step
        _tryProcessMintings();

        // expand RToken supply
        _expandSupply();

        // trade out collateral for other collateral or insurance RSR
        _rebalance();
        _;
    }

    /// ========================= External =============================

    /// Configuration changes, only callable by Owner.
    function updateConfig(Config memory newConfig) external override onlyOwner {
        emit ConfigUpdated();
        config = newConfig;
        _updateBasket();
    }

    /// Callable by anyone, runs all the perBlockUpdates
    function act() external override everyBlock {
        return;
    }

    /// Handles issuance.
    /// Requires approvals to be in place beforehand.
    function issue(uint256 amount) external override everyBlock {
        require(amount > config.minMintingSize, "cannot issue less than minMintingSize");
        require(basket.size > 0, "basket cannot be empty");
        require(!ICircuitBreaker(config.circuitBreaker).check(), "circuit breaker tripped");

        uint256[] memory amounts = issueAmounts(amount);
        for (uint16 i = 0; i < basket.size; i++) {
            basket.tokens[i].safeTransferFrom(
                _msgSender(),
                address(this),
                amounts[i]
            );
        }

        // puts minting on the queue
        _startSlowMinting(_msgSender(), amount);
    }

    /// Handles redemption.
    function redeem(uint256 amount) external override everyBlock {
        require(amount > 0, "cannot redeem 0 RToken");
        require(basket.size > 0, "basket cannot be empty");

        uint256[] memory amounts = redemptionAmounts(amount);
        _burn(_msgSender(), amount);
        for (uint16 i = 0; i < basket.size; i++) {
            basket.tokens[i].safeTransfer(_msgSender(), amounts[i]);
        }

        emit Redemption(_msgSender(), amount);
    }

    /// Trading freeze
    function freezeTrading() external override {
        if (tradingFrozen()) {
            rsrToken.safeTransfer(freezer, config.tradingFreezeCost);
        }

        rsrToken.safeTransferFrom(_msgSender(), address(this), config.tradingFreezeCost);
        freezer = _msgSender();
        emit TradingFrozen(_msgSender());
    }

    /// Trading unfreeze
    function unfreezeTrading() external override {
        require(tradingFrozen(), "already unfrozen");
        require(_msgSender() == freezer, "only freezer can unfreeze");

        rsrToken.safeTransfer(freezer, config.tradingFreezeCost);
        freezer = address(0);
        emit TradingUnfrozen(_msgSender());
    }

    function setBasketTokenPriceInRToken(uint16 i, uint256 priceInRToken) external override onlyOwner {
        basket.tokens[i].priceInRToken = priceInRToken;
    }

    function setRSRPriceInRToken(uint256 priceInRToken) external override onlyOwner {
        rsrToken.priceInRToken = priceInRToken;
    }


    /// =========================== Views =================================

    function tradingFrozen() public view override returns (bool) {
        return freezer != address(0);
    }

    function issueAmounts(uint256 amount) public view override returns(uint256[] memory amounts) {
        return basket.issueAmounts(amount, SCALE, config.spread, decimals());
    }

    function redemptionAmounts(uint256 amount) public view override returns(uint256[] memory amounts) {
        return basket.redemptionAmounts(amount, decimals(), totalSupply());
    }

    function stakingDepositDelay() external view override returns(uint256) {
        return config.stakingDepositDelay;
    }

    function stakingWithdrawalDelay() external view override returns(uint256) {
        return config.stakingWithdrawalDelay;
    }

    function insurancePool() external view override returns(address) {
        return config.insurancePool;
    }

    function basketSize() external view override returns(uint16) {
        return basket.size;
    }

    /// Can be used in conjuction with `transfer` methods to account for fees.
    function calculateFee(
        address from,
        address to,
        uint256 amount
    ) public view override returns (uint256) {
        if (config.txFeeCalculator == address(0)) {
            return 0;
        }

        return MathUpgradeable.min(amount, ITXFee(config.txFeeCalculator).calculateFee(from, to, amount));
    }


    /// =========================== Internal =================================

    /// Sets the adjusted basket quantities for the current block 
    function _updateBasket() internal {
        for (uint16 i = 0; i < basket.size; i++) {
            basket.tokens[i].adjustQuantity(SCALE, config.supplyExpansionRate, _deployedAt);
        }
    }

    /// Tries to process up to a fixed number of mintings. Called before most actions.
    function _tryProcessMintings() internal {
        if (!ICircuitBreaker(config.circuitBreaker).check()) {
            uint256 start = currentMinting;
            uint256 blocksSince = block.number - _lastBlock;
            uint256 issuanceAmount = config.issuanceRate;
            while (currentMinting < mintings.length && currentMinting < start + 10000) {
                // TODO: Tune the +10000 maximum. Might have to be smaller.
                Minting storage m = mintings[currentMinting];

                // Break if the next minting is too big.
                if (m.amount > issuanceAmount * (blocksSince)) {
                    break;
                }
                _mint(m.account, m.amount);
                emit SlowMintingComplete(m.account, m.amount);

                // update remaining
                if(m.amount >= issuanceAmount) {
                    issuanceAmount = 0;
                } else {
                    issuanceAmount -= m.amount;
                }

                uint256 blocksUsed = m.amount / config.issuanceRate;
                if (blocksUsed * config.issuanceRate > m.amount) {
                    blocksUsed = blocksUsed + 1;
                }
                blocksSince = blocksSince - blocksUsed;
               
                delete mintings[currentMinting]; // gas saving..?
                
                currentMinting++;
            }
            
            // update _lastBlock if tokens were minted
            if(currentMinting > start) {
                _lastBlock = block.number;
            }        
        }
    }

    /// Expands the RToken supply and gives the new mintings to the protocol fund and
    /// the insurance pool.
    function _expandSupply() internal {
        // 31536000 = seconds in a year
        uint256 toExpand = (totalSupply() *
            config.supplyExpansionRate *
            (block.timestamp - _lastTimestamp)) /
            31536000 /
            SCALE;
        _lastTimestamp = block.timestamp;
        if (toExpand == 0) {
            return;
        }

        // Mint to protocol fund
        if (config.expenditureFactor > 0) {
            uint256 e = (toExpand * MathUpgradeable.min(SCALE, config.expenditureFactor)) /
                SCALE;
                (config.protocolFund, e);
        }

        // Mint to self
        if (config.expenditureFactor < SCALE) {
            uint256 p = (toExpand * (SCALE - config.expenditureFactor)) / SCALE;
            _mint(address(this), p);
        }

        // Batch transfers from self to InsurancePool
        if (balanceOf(address(this)) > (totalSupply() * config.revenueBatchSize) / SCALE) {
            _approve(address(this), config.insurancePool, balanceOf(address(this)));
            IInsurancePool(config.insurancePool).notifyRevenue(false, balanceOf(address(this)));
        }
    }

    /// Trades tokens against the IAtomicExchange with per-block rate limiting
    function _rebalance() internal {
        uint256 numBlocks = block.number - _lastBlock;
        _lastBlock = block.number;
        if (tradingFrozen() || numBlocks == 0) {
            return;
        }

        uint8 decimals = decimals();
        uint256 totalSupply = totalSupply();
        int32 indexLowest = basket.leastCollateralized(decimals, totalSupply);
        int32 indexHighest = basket.mostCollateralized(decimals, totalSupply);

        /// Three cases:
        /// 1. Sideways: Trade collateral for collateral
        /// 2. Sell RSR: Trade RSR for collateral
        /// 3. Buyback RSR: Trade collateral for RSR
        if (indexLowest >= 0 && indexHighest >= 0) {
            // Sell as much excess collateral as possible for missing collateral

            Token.Info storage lowToken = basket.tokens[uint16(uint32(indexLowest))];
            Token.Info storage highToken = basket.tokens[uint16(uint32(indexHighest))];
            uint256 sell = MathUpgradeable.min(highToken.maxTrade, MathUpgradeable.min(
                numBlocks * highToken.rateLimit,
                highToken.getBalance() - (totalSupply * highToken.adjustedQuantity) / 10**decimals
            ));
            uint256 minBuy = (sell * lowToken.priceInRToken) / highToken.priceInRToken;
            minBuy = (minBuy * MathUpgradeable.min(lowToken.slippageTolerance, SCALE)) / SCALE;
            minBuy = (minBuy * MathUpgradeable.min(highToken.slippageTolerance, SCALE)) / SCALE;
            _tradeWithFixedSellAmount(highToken, lowToken, sell, minBuy);
        } else if (indexLowest >= 0) {
            // 1. Seize RSR from the insurance pool
            // 2. Trade some-to-all of the seized RSR for missing collateral
            // 3. Return any leftover RSR

            Token.Info storage lowToken = basket.tokens[uint16(uint32(indexLowest))];
            uint256 toSeize = MathUpgradeable.min(numBlocks * rsrToken.rateLimit, rsrToken.maxTrade);
            uint256 sell = IInsurancePool(config.insurancePool).seizeRSR(toSeize);
            uint256 minBuy = (sell * lowToken.priceInRToken) / rsrToken.priceInRToken;
            minBuy = (minBuy * MathUpgradeable.min(lowToken.slippageTolerance, SCALE)) / SCALE;
            minBuy = (minBuy * MathUpgradeable.min(rsrToken.slippageTolerance, SCALE)) / SCALE;
            _tradeWithFixedSellAmount(rsrToken, lowToken, sell, minBuy);

            // Clean up any leftover RSR
            if (rsrToken.getBalance() > 0) {
                rsrToken.safeApprove(config.insurancePool, rsrToken.getBalance());
                IInsurancePool(config.insurancePool).notifyRevenue(true, rsrToken.getBalance());
                rsrToken.safeApprove(config.insurancePool, 0);
            }
        } else if (indexHighest >= 0) {
            // Sell as much excess collateral as possible for RSR

            Token.Info storage highToken = basket.tokens[uint16(uint32(indexHighest))];
            uint256 sell = MathUpgradeable.min(numBlocks * highToken.rateLimit, highToken.maxTrade);
            uint256 minBuy = (sell * rsrToken.priceInRToken) / highToken.priceInRToken;
            minBuy = (minBuy * MathUpgradeable.min(highToken.slippageTolerance, SCALE)) / SCALE;
            minBuy = (minBuy * MathUpgradeable.min(rsrToken.slippageTolerance, SCALE)) / SCALE;
            _tradeWithFixedSellAmount(highToken, rsrToken, sell, minBuy);
        }
    }

    /// Starts a slow minting
    function _startSlowMinting(address account, uint256 amount) internal {
        require(account != address(0), "ERC20: mint to the zero address");
        require(amount > 0, "cannot mint 0");

        Minting memory m = Minting(amount, account);
        mintings.push(m);

        // update _lastBlock if this is the only item in queue
        if (mintings.length == currentMinting + 1) {
            _lastBlock = block.number;
        }
        emit SlowMintingInitiated(account, amount);
    }


    function _tradeWithFixedSellAmount(
        Token.Info storage sellToken,
        Token.Info storage buyToken,
        uint256 sellAmount,
        uint256 minBuyAmount
    ) internal {
        // TODO: Try catch so that trading failures don't block issuance/redemption


        uint256 initialSellBal = sellToken.getBalance();
        uint256 initialBuyBal = buyToken.getBalance();
        sellToken.safeApprove(config.exchange, sellAmount);
        IAtomicExchange(config.exchange).tradeFixedSell(
            sellToken.tokenAddress,
            buyToken.tokenAddress,
            sellAmount,
            minBuyAmount
        );
        require(
            sellToken.getBalance() - initialSellBal == sellAmount,
            "bad sell, though maybe exact equality is too much to ask"
        );
        require(
            buyToken.getBalance() - initialBuyBal >= minBuyAmount,
            "bad buy"
        );
        sellToken.safeApprove(config.exchange, 0);
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
     * The fee is _in addition_ to the transfer amount.
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        if (
            from != address(0) && to != address(0) && address(config.txFeeCalculator) != address(0)
        ) {
            uint256 fee = MathUpgradeable.min(amount, ITXFee(config.txFeeCalculator).calculateFee(from, to, amount));

            // Cheeky way of doing the fee without needing access to underlying _balances array
            _burn(from, fee);
            _mint(address(this), fee);
        }
    }

    function _mint(address recipient, uint256 amount) internal override {
        super._mint(recipient, amount);
        require(totalSupply() < config.maxSupply, "Max supply exceeded");
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
