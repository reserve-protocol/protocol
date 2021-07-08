// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";

import "./libraries/AppConfiguration.sol";
import "./libraries/CollateralManager.sol";
import "./interfaces/ITXFee.sol";
import "./interfaces/IRToken.sol";
import "./interfaces/IAtomicExchange.sol";
import "./interfaces/IInsurancePool.sol";
import "./interfaces/IConfiguration.sol";
import "./SlowMintingERC20.sol";

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
contract RToken is ERC20VotesUpgradeable, Initializable, IRToken, UUPSUpgradeable {
    using SafeERC20 for IERC20;
    using Token for Token.Info;


    /// Meta-parameter, used to help define proportional values
    uint256 public constant SCALE = 1e18;

    RTokenConfig config;
    Basket.Info basket;
    Token.Info insuranceToken;

    /// Relay data
    mapping(address => uint256) metaNonces;

    /// SlowMinting data
    Minting[] mintings;
    uint256 currentMinting;

    uint256 private _deployedAt;
    uint256 private _lastTimestamp;
    uint256 private _lastBlock;

    function initialize(
        address owner_,
        string memory name_,
        string memory symbol_,
        AppStorage storage conf_
    ) external initializer {
        __ERC20Votes_init_unchained();
        __UUPSUpgradeable_init();

        _transferOwnership(owner_)
        _deployedAt = block.timestamp;
        _lastTimestamp = block.timestamp;
        _lastBlock = block.number;
        _updateBasket();
    }

    modifier canTrade() {
        require(!tradingFrozen(), "tradingFrozen is frozen, but you can transfer or redeem");
        _;
    }

    /// These sub-functions should all be idempotent within a block
    modifier everyBlock() {

        // decrease basket quantities based on blocknumber
        _updateBasket();

        // SlowMintingERC20 update step
        tryProcessMintings(s.mintings.length - currentMinting);

        // expand RToken supply
        _expandSupply();

        // trade out collateral for other collateral or insurance RSR
        _rebalance();
        _;
    }

    /// ========================= External =============================

    /// Configuration changes, only callable by Owner.
    function changeConfiguration(address newConf) external override onlyOwner {
        emit ConfigurationChanged(address(conf), newConf);
        conf = IConfiguration(newConf);
        _updateBasket();
    }

    function takeSnapshot() external override onlyOwner returns (uint256) {
        return _snapshot();
    }

    /// Callable by anyone, runs all the perBlockUpdates
    function act() external override everyBlock {
        return;
    }

    /// Handles issuance.
    /// Requires approvals to be in place beforehand.
    function issue(uint256 amount) external override everyBlock {
        require(amount > 0, "cannot issue zero RToken");
        require(basket.size > 0, "basket cannot be empty");
        require(!ICircuitBreaker(s.circuitBreaker).check(), "circuit breaker tripped");

        uint256[] memory amounts = CollateralManager.issueAmounts(s, amount);
        for (uint256 i = 0; i < basket.size; i++) {
            IERC20(basket.tokens[i].tokenAddress).safeTransferFrom(
                _msgSender(),
                address(this),
                amounts[i]
            );
        }

        // puts minting on the queue
        _startMinting(_msgSender(), amount);
        emit Issuance(_msgSender(), amount);
    }

    /// Handles redemption.
    function redeem(uint256 amount) external override everyBlock {
        require(amount > 0, "cannot redeem 0 RToken");
        require(basket.size > 0, "basket cannot be empty");

        uint256[] memory amounts = CollateralManager.redemptionAmounts(s, amount);
        _burn(_msgSender(), amount);
        for (uint256 i = 0; i < basket.size; i++) {
            IERC20(basket.tokens[i].tokenAddress).safeTransfer(_msgSender(), amounts[i]);
        }

        emit Redemption(_msgSender(), amount);
    }

    /// Trading freeze
    function freezeTrading() external override everyBlock {
        address rsrAddress = conf.insuranceTokenAddress();

        if (freezer != address(0)) {
            IERC20(rsrAddress).safeTransfer(freezer, conf.tradingFreezeCost());
        }

        IERC20(rsrAddress).safeTransferFrom(_msgSender(), address(this), conf.tradingFreezeCost());
        freezer = _msgSender();
        emit TradingFrozen(_msgSender());
    }

    /// Trading unfreeze
    function unfreezeTrading() external override everyBlock {
        require(tradingFrozen(), "already unfrozen");
        require(_msgSender() == freezer, "only freezer can unfreeze");
        address rsrAddress = conf.insuranceTokenAddress();

        IERC20(rsrAddress).safeTransfer(freezer, conf.tradingFreezeCost());
        freezer = address(0);
        emit TradingUnfrozen(_msgSender());
    }

    /// =========================== Views =================================

    function tradingFrozen() public view override returns (bool) {
        return freezer != address(0);
    }

    function isFullyCollateralized() public view override returns (bool) {
        for (uint256 i = 0; i < basket.size; i++) {
            uint256 expected = (totalSupply() * basket.tokens[i].quantity) / 10**decimals();
            if (IERC20(basket.tokens[i].tokenAddress).balanceOf(address(this)) < expected) {
                return false;
            }
        }
        return true;
    }

    /// Returns index of least collateralized token, or -1 if fully collateralized.
    function leastCollateralized() public view override returns (int256) {
        uint256 largestDeficitNormed;
        int256 index = -1;

        for (uint256 i = 0; i < basket.size; i++) {
            uint256 bal = IERC20(basket.tokens[i].tokenAddress).balanceOf(address(this));
            uint256 expected = (totalSupply() * basket.tokens[i].quantity) / 10**decimals();

            if (bal < expected) {
                uint256 deficitNormed = (expected - bal) / basket.tokens[i].quantity;
                if (deficitNormed > largestDeficitNormed) {
                    largestDeficitNormed = deficitNormed;
                    index = int256(i);
                }
            }
        }
        return index;
    }

    /// Returns the index of the most collateralized token, or -1.
    function mostCollateralized() public view override returns (int256) {
        uint256 largestSurplusNormed;
        int256 index = -1;

        for (uint256 i = 0; i < basket.size; i++) {
            uint256 bal = IERC20(basket.tokens[i].tokenAddress).balanceOf(address(this));
            uint256 expected = (totalSupply() * basket.tokens[i].quantity) / 10**decimals();
            expected += basket.tokens[i].rateLimit;

            if (bal > expected) {
                uint256 surplusNormed = (bal - expected) / basket.tokens[i].quantity;
                if (surplusNormed > largestSurplusNormed) {
                    largestSurplusNormed = surplusNormed;
                    index = int256(i);
                }
            }
        }
        return index;
    }

    /// Can be used in conjuction with `transfer` methods to account for fees.
    function adjustedAmountForFee(
        address from,
        address to,
        uint256 amount
    ) public override returns (uint256) {
        if (conf.txFeeCalculator() == address(0)) {
            return 0;
        }

        return ITXFee(conf.txFeeCalculator()).calculateAdjustedAmountToIncludeFee(from, to, amount);
    }

    /// Tries to process `count` mintings. Called before most actions.
    /// Can also be called directly if we get to the block gas limit.
    function tryProcessMintings(uint256 count) public {
        if (!ICircuitBreaker(conf.circuitBreaker()).check()) {
            uint256 start = currentMinting;
            uint256 blocksSince = block.number - lastBlockChecked;
            uint256 issuanceAmount = conf.issuanceRate();
            while (currentMinting < mintings.length && currentMinting < start + count) {
                Minting storage m = mintings[currentMinting];

                // Break if the next minting is too big.
                if (m.amount > issuanceAmount * (blocksSince)) {
                    break;
                }
                _mint(m.account, m.amount);
                emit MintingComplete(m.account, m.amount);

                // update remaining
                if(m.amount >= issuanceAmount) {
                    issuanceAmount = 0;
                } else {
                    issuanceAmount -= m.amount;
                }

                uint256 blocksUsed = m.amount / conf.issuanceRate();
                if (blocksUsed * conf.issuanceRate() > m.amount) {
                    blocksUsed = blocksUsed + 1;
                }
                blocksSince = blocksSince - blocksUsed;
               
                delete mintings[currentMinting]; // gas saving..?
                
                currentMinting++;
            }
            
            // update lastBlockChecked if tokens were minted
            if(currentMinting > start) {
                lastBlockChecked = block.number;
            }        
        }
    }

    /// =========================== Internal =================================

    /// Starts a slow minting
    function _startMinting(address account, uint256 amount) internal {
        require(account != address(0), "ERC20: mint to the zero address");
        require(amount > 0, "cannot mint 0");

        Minting memory m = Minting(amount, account);
        s.mintings.push(m);

        // update lastBlockChecked if this is the only item in queue
        if (s.mintings.length == s.currentMinting + 1) {
            lastBlockChecked = block.number;
        }
        emit MintingInitiated(account, amount);
    }

    /// Sets the adjusted basket quantities for the current block 
    function _updateBasket() internal {
        for (uint16 i = 0; i < basket.size; i++) {
            basket.tokens[i].adjustQuantity(SCALE, config.supplyExpansionRate, _deployedAt);
        }
    }

    /// Expands the RToken supply and gives the new mintings to the protocol fund and
    /// the insurance pool.
    function _expandSupply() internal {
        // 31536000 = seconds in a year
        uint256 toExpand = (totalSupply() *
            conf.supplyExpansionRate() *
            (block.timestamp - lastTimestamp)) /
            31536000 /
            conf.SCALE();
        lastTimestamp = block.timestamp;
        if (toExpand == 0) {
            return;
        }

        // Mint to protocol fund
        if (conf.expenditureFactor() > 0) {
            uint256 e = (toExpand * MathUpgradeable.min(conf.SCALE(), conf.expenditureFactor())) /
                conf.SCALE();
                (conf.protocolFund(), e);
        }

        // Mint to self
        if (conf.expenditureFactor() < conf.SCALE()) {
            uint256 p = (toExpand * (conf.SCALE() - conf.expenditureFactor())) / conf.SCALE();
            _mint(address(this), p);
        }

        // Batch transfers from self to InsurancePool
        if (balanceOf(address(this)) > (totalSupply() * conf.revenueBatchSize()) / conf.SCALE()) {
            _approve(address(this), conf.insurancePool(), balanceOf(address(this)));
            IInsurancePool(conf.insurancePool()).notifyRevenue(false, balanceOf(address(this)));
        }
    }

    /// Trades tokens against the IAtomicExchange with per-block rate limiting
    function _rebalance() internal {
        uint256 numBlocks = block.number - lastBlock;
        lastBlock = block.number;
        if (tradingFrozen() || numBlocks == 0) {
            return;
        }

        int256 indexLowest = leastCollateralized();
        int256 indexHighest = mostCollateralized();

        /// Three cases:
        /// 1. Sideways: Trade collateral for collateral
        /// 2. Sell RSR: Trade RSR for collateral
        /// 3. Buyback RSR: Trade collateral for RSR
        if (indexLowest >= 0 && indexHighest >= 0) {
            // Sell as much excess collateral as possible for missing collateral

            Token storage lowToken = basket.tokens[uint256(indexLowest)];
            Token storage highToken = basket.tokens[uint256(indexHighest)];
            uint256 sell = MathUpgradeable.min(
                numBlocks * highToken.rateLimit,
                IERC20(highToken.tokenAddress).balanceOf(address(this)) -
                    (totalSupply() * highToken.quantity) /
                    10**decimals()
            );
            uint256 minBuy = (sell * lowToken.priceInRToken) / highToken.priceInRToken;
            minBuy = (minBuy * MathUpgradeable.min(lowToken.slippageTolerance, conf.SCALE())) / conf.SCALE();
            minBuy = (minBuy * MathUpgradeable.min(highToken.slippageTolerance, conf.SCALE())) / conf.SCALE();
            _tradeWithFixedSellAmount(highToken.tokenAddress, lowToken.tokenAddress, sell, minBuy);
        } else if (indexLowest >= 0) {
            // 1. Seize RSR from the insurance pool
            // 2. Trade some-to-all of the seized RSR for missing collateral
            // 3. Return any leftover RSR

            Token storage lowToken = basket.tokens[uint256(indexLowest)];
            (
                address rsrAddress,
                ,
                uint256 rsrRateLimit,
                uint256 rsrPriceInRToken,
                uint256 rsrSlippageTolerance
            ) = conf.insuranceToken();
            uint256 sell = numBlocks * rsrRateLimit;
            sell = IInsurancePool(conf.insurancePool()).seizeRSR(sell);
            uint256 minBuy = (sell * lowToken.priceInRToken) / rsrPriceInRToken;
            minBuy = (minBuy * MathUpgradeable.min(lowToken.slippageTolerance, conf.SCALE())) / conf.SCALE();
            minBuy = (minBuy * MathUpgradeable.min(rsrSlippageTolerance, conf.SCALE())) / conf.SCALE();
            _tradeWithFixedSellAmount(rsrAddress, lowToken.tokenAddress, sell, minBuy);

            // Clean up any leftover RSR
            uint256 rsrBalance = IERC20(rsrAddress).balanceOf(address(this));
            if (rsrBalance > 0) {
                IERC20(rsrAddress).safeApprove(conf.insurancePool(), rsrBalance);
                IInsurancePool(conf.insurancePool()).notifyRevenue(true, rsrBalance);
            }
        } else if (indexHighest >= 0) {
            // Sell as much excess collateral as possible for RSR

            Token storage highToken = basket.tokens[uint256(indexHighest)];
            (address rsrAddress, , , uint256 rsrPriceInRToken, uint256 rsrSlippageTolerance) = conf
            .insuranceToken();
            uint256 sell = numBlocks * highToken.rateLimit;
            uint256 minBuy = (sell * rsrPriceInRToken) / highToken.priceInRToken;
            minBuy = (minBuy * MathUpgradeable.min(highToken.slippageTolerance, conf.SCALE())) / conf.SCALE();
            minBuy = (minBuy * MathUpgradeable.min(rsrSlippageTolerance, conf.SCALE())) / conf.SCALE();
            _tradeWithFixedSellAmount(highToken.tokenAddress, rsrAddress, sell, minBuy);
        }
    }

    function _tradeWithFixedSellAmount(
        address sellToken,
        address buyToken,
        uint256 sellAmount,
        uint256 minBuyAmount
    ) internal {
        uint256 initialSellBal = IERC20(sellToken).balanceOf(address(this));
        uint256 initialBuyBal = IERC20(buyToken).balanceOf(address(this));
        IERC20(sellToken).safeApprove(conf.exchange(), sellAmount);
        IAtomicExchange(conf.exchange()).tradeFixedSell(
            sellToken,
            buyToken,
            sellAmount,
            minBuyAmount
        );
        require(
            IERC20(sellToken).balanceOf(address(this)) - initialSellBal == sellAmount,
            "bad sell"
        );
        require(
            IERC20(buyToken).balanceOf(address(this)) - initialBuyBal >= minBuyAmount,
            "bad buy"
        );
        IERC20(sellToken).safeApprove(conf.exchange(), 0);
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
    ) internal override(ERC20, ERC20Snapshot) {
        if (
            from != address(0) && to != address(0) && address(conf.txFeeCalculator()) != address(0)
        ) {
            uint256 fee = MathUpgradeable.min(amount, ITXFee(s.txFeeCalculator).calculateFee(from, to, amount));

            // Cheeky way of doing the fee without needing access to underlying _balances array
            _burn(from, fee);
            _mint(address(this), fee);
        }
    }

    function _mint(address recipient, uint256 amount) internal override {
        super._mint(recipient, amount);
        require(totalSupply() < s.maxSupply, "Max supply exceeded");
    }
}
