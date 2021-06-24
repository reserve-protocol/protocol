// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./zeppelin/token/ERC20/extensions/ERC20Snapshot.sol";
import "./zeppelin/token/ERC20/utils/SafeERC20.sol";
import "./zeppelin/token/ERC20/IERC20.sol";
import "./zeppelin/access/Ownable.sol";
import "./zeppelin/utils/math/Math.sol";
import "./interfaces/ITXFee.sol";
import "./interfaces/IRToken.sol";
import "./interfaces/IAtomicExchange.sol";
import "./interfaces/IInsurancePool.sol";
import "./interfaces/IConfiguration.sol";
import "./upgradeable/SimpleOrderbookExchange.sol";
import "./SlowMintingERC20.sol";

struct Token {
    address tokenAddress;

    // How many tokens for each 1e18 RTokens 
    uint256 quantity;

    // How many tokens to sell per each block
    uint256 rateLimit;

    // How many tokens are equal in value to 1e18 RTokens (will always be a little stale)
    uint256 priceInRToken;

    // A number <=1e18 that indicates how much price movement to allow. 
    // E.g., 5e17 means up to a 50% price movement before the RToken halts trading. 
    // The slippage for a pair is the combination of two `slippageTolerance` 
    uint256 slippageTolerance;
}

struct Basket {
    mapping(uint256 => Token) tokens;
    uint256 size;
}

/**
 * @title RToken
 * @dev An ERC-20 token with built-in rules for price stabilization centered around a basket. 
 * 
 * RTokens can:
 *    - scale up or down in supply (nearly) completely elastically
 *    - change their backing while maintaining price
 *    - and, recover from collateral defaults through insurance
 * 
 * Only the owner (which should be set to a TimelockController) can change the Configuration.
 */
contract RToken is ERC20Snapshot, IRToken, Ownable, SlowMintingERC20 {
    using SafeERC20 for IERC20;

    /// Max Fee on transfers, ever. 
    uint256 public constant MAX_FEE = 5e16; // 5%

    /// ==== Mutable State ====

    // Updates every block with slightly decayed token quantities
    Basket public basket; 

    /// Set to 0 address when not frozen
    address public freezer;

    /// since last
    uint256 public lastTimestamp;
    uint256 public lastBlock;

    constructor(
        address owner_,
        string memory name_, 
        string memory symbol_, 
        address conf_
    ) SlowMintingERC20(name_, symbol_, conf_) {
        transferOwnership(owner_);
        lastTimestamp = block.timestamp;
        lastBlock = block.number;
    }

    modifier canTrade() {
        require(!tradingFrozen() , "tradingFrozen is frozen, but you can transfer or redeem");
        _;
    }


    /// These sub-functions should all be idempotent within a block
    modifier everyBlock() {
        // TODO: Confirm this is the right order

        tryProcessMintings(); // SlowMintingERC20 update step

        // set basket quantities based on blocknumber
        _updateBasket();

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

    function takeSnapshot() external override onlyOwner returns(uint256) {
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
        require(amount < conf.maxSupply(), "at max supply");
        require(basket.size > 0, "basket cannot be empty");
        require(!ICircuitBreaker(conf.circuitBreaker()).check(), "circuit breaker tripped");

        uint256[] memory amounts = issueAmounts(amount);
        for (uint256 i = 0; i < basket.size; i++) {
            IERC20(basket.tokens[i].tokenAddress).safeTransferFrom(
                _msgSender(),
                address(this),
                amounts[i]
            );
        }

        // startMinting() puts it on the queue
        startMinting(_msgSender(), amount);
        emit Issuance(_msgSender(), amount);
    }

    /// Handles redemption.
    function redeem(uint256 amount) external override everyBlock {
        require(amount > 0, "cannot redeem 0 RToken");
        require(basket.size > 0, "basket cannot be empty");

        uint256[] memory amounts = redemptionAmounts(amount);
        _burn(_msgSender(), amount);
        for (uint256 i = 0; i < basket.size; i++) {
            IERC20(basket.tokens[i].tokenAddress).safeTransfer(
                _msgSender(),
                amounts[i]
            );
        }

        emit Redemption(_msgSender(), amount);
    }

    /// Trading freeze
    function freezeTrading() external override everyBlock {
        if (freezer != address(0)) {
            IERC20(conf.rsrToken()).safeTransfer(
                freezer,
                conf.tradingFreezeCost()
            );
        }

        IERC20(conf.rsrToken()).safeTransferFrom(
            _msgSender(),
            address(this),
            conf.tradingFreezeCost()
        );
        freezer = _msgSender();
        emit TradingFrozen(_msgSender());
    }

    /// Trading unfreeze
    function unfreezeTrading() external override everyBlock {
        require(tradingFrozen(), "already unfrozen");
        require(_msgSender() == freezer, "only freezer can unfreeze");
        IERC20(conf.rsrToken()).safeTransfer(
            freezer,
            conf.tradingFreezeCost()
        );
        freezer = address(0);
        emit TradingUnfrozen(_msgSender());
    }

    /// =========================== Views =================================

    function tradingFrozen() public view override returns (bool) {
        return freezer != address(0);
    }

    function isFullyCollateralized() public view override returns (bool) {
        for (uint256 i = 0; i < basket.size; i++) {
            uint256 expected = totalSupply() * basket.tokens[i].quantity / 10**decimals();
            if (IERC20(basket.tokens[i].tokenAddress).balanceOf(address(this)) < expected) {
                return false;
            }
        }
        return true;
    }

    /// The returned array will be in the same order as the current basket.
    function issueAmounts(uint256 amount) public view override returns (uint256[] memory) {
        uint256[] memory parts = new uint256[](basket.size);
        uint256 quantity;
        for (uint256 i = 0; i < basket.size; i++) {
            Token memory ct = basket.tokens[i];
            parts[i] = amount * ct.quantity / 10**decimals();
            parts[i] = parts[i] * (conf.SCALE() + conf.spreadScaled()) / conf.SCALE();
        }

        return parts;
    }


    /// The returned array will be in the same order as the current basket.
    function redemptionAmounts(uint256 amount) public view override returns (uint256[] memory) {
        uint256[] memory parts = new uint256[](basket.size);
        for (uint256 i = 0; i < basket.size; i++) {
            Token memory ct = basket.tokens[i];
            uint256 bal = IERC20(ct.tokenAddress).balanceOf(address(this));
            if (isFullyCollateralized()) {
                parts[i] = ct.quantity * amount / 10**decimals();
            } else {
                parts[i] = bal * amount / totalSupply();
            }
        }

        return parts;
    }

    /// Returns index of least collateralized token, or -1 if fully collateralized.
    function leastCollateralized() public view override returns (int256) {
        uint256 largestDeficitNormed;
        int256 index = -1;

        for (uint256 i = 0; i < basket.size; i++) {
            uint256 bal = IERC20(basket.tokens[i].tokenAddress).balanceOf(address(this));
            uint256 expected = totalSupply() * basket.tokens[i].quantity / 10**decimals();

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
            uint256 expected = totalSupply() * basket.tokens[i].quantity / 10**decimals();
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
    function adjustedAmountForFee(address from, address to, uint256 amount) public override returns (uint256) {
        if (conf.txFee() == address(0)) {
            return 0;
        }

        return ITXFee(conf.txFee()).calculateAdjustedAmountToIncludeFee(from, to, amount);
    }

    /// =========================== Internal =================================

    /// Gets the quantity-adjusted basket from Configuration
    function _updateBasket() internal {
        basket.size = conf.getBasketSize();
        for (uint256 i = 0; i < conf.getBasketSize(); i++) {
            Token memory t;
            (t.tokenAddress, t.quantity, t.rateLimit, t.priceInRToken, t.slippageTolerance) = conf.getBasketTokenAdjusted(i);
            basket.tokens[i] = t;
        }
    }

    /// Expands the RToken supply and gives the new mintings to the protocol fund and 
    /// the insurance pool.
    function _expandSupply() internal {
        // 31536000 = seconds in a year
        uint256 toExpand = totalSupply() * conf.supplyExpansionRateScaled() * (block.timestamp - lastTimestamp) / 31536000 / conf.SCALE() ;
        lastTimestamp = block.timestamp;
        if (toExpand == 0) {
            return;
        }

        // Mint to protocol fund
        if (conf.expenditureFactorScaled() > 0) {
            uint256 e = toExpand * Math.min(conf.SCALE(), conf.expenditureFactorScaled()) / conf.SCALE();
            _mint(conf.protocolFund(), e);
        }

        // Mint to self
        if (conf.expenditureFactorScaled() < conf.SCALE()) {
            uint256 p = toExpand * (conf.SCALE() - conf.expenditureFactorScaled()) / conf.SCALE();
            _mint(address(this), p);
        }

        // Batch transfers from self to InsurancePool
        if (balanceOf(address(this)) > totalSupply() * conf.revenueBatchSizeScaled() / conf.SCALE()) {
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

            Token storage lowToken = basket.tokens[indexLowest];
            Token storage highToken = basket.tokens[indexHighest];
            uint256 sell = Math.min(numBlocks * highToken.rateLimit, IERC20(highToken.tokenAddress).balanceOf(address(this)) - totalSupply() * highToken.quantity / 10**decimals());
            uint256 minBuy = sell * lowToken.priceInRToken / highToken.priceInRToken;
            minBuy = minBuy * Math.min(lowToken.slippageTolerance, conf.SCALE()) / conf.SCALE();
            minBuy = minBuy * Math.min(highToken.slippageTolerance, conf.SCALE()) / conf.SCALE();
            _tradeWithFixedSellAmount(highToken.tokenAddress, lowToken.tokenAddress, sell, minBuy);

        } else if (indexLowest >= 0) {
            // 1. Seize RSR from the insurance pool
            // 2. Trade some-to-all of the seized RSR for missing collateral
            // 3. Return any leftover RSR

            Token storage lowToken = basket.tokens[indexLowest];
            (   
                address rsrAddress,
                ,
                uint256 rsrRateLimit, 
                uint256 rsrPriceInRToken, 
                uint256 rsrSlippageTolerance
            ) = conf.insuranceToken();
            uint256 sell = numBlocks * rsrRateLimit;
            sell = IInsurancePool(conf.insurancePool()).seizeRSR(sell);
            uint256 minBuy = sell * lowToken.priceInRToken / rsrPriceInRToken;
            minBuy = minBuy * Math.min(lowToken.slippageTolerance, conf.SCALE() ) / conf.SCALE();
            minBuy = minBuy * Math.min(rsrSlippageTolerance, conf.SCALE()) / conf.SCALE();
            _tradeWithFixedSellAmount(rsrAddress, lowToken.tokenAddress, sell, minBuy);

            // Clean up any leftover RSR
            uint256 rsrBalance = IERC20(rsrAddress).balanceOf(address(this));
            if (rsrBalance > 0) {
                IERC20(rsrAddress).safeApprove(conf.insurancePool(), rsrBalance);
                IInsurancePool(conf.insurancePool()).notifyRevenue(true, rsrBalance);
            }

        } else if (indexHighest >= 0) {
            // Sell as much excess collateral as possible for RSR

            Token storage highToken = basket.tokens[indexHighest];
            (   
                address rsrAddress,
                ,
                uint256 rsrRateLimit, 
                uint256 rsrPriceInRToken, 
                uint256 rsrSlippageTolerance
            ) = conf.insuranceToken();
            uint256 sell = numBlocks * highToken.rateLimit;
            uint256 minBuy = sell * rsrPriceInRToken / highToken.priceInRToken;
            minBuy = minBuy * Math.min(highToken.slippageTolerance, conf.SCALE() ) / conf.SCALE();
            minBuy = minBuy * Math.min(rsrSlippageTolerance, conf.SCALE()) / conf.SCALE();
            _tradeWithFixedSellAmount(highToken.tokenAddress, rsrAddress, sell, minBuy);

        }

    }

    function _tradeWithFixedSellAmount(
        address sellToken, 
        address buyToken, 
        uint256 sellAmount,
        uint256 minBuyAmount,
    ) internal {
        uint256 initialSellBal = IERC20(sellToken).balanceOf(address(this));
        uint256 initialBuyBal = IERC20(buyToken).balanceOf(address(this));
        IERC20(sellToken).safeApprove(conf.exchange(), sellAmount);
        IAtomicExchange(conf.exchange()).tradeFixedSell(sellToken, buyToken, sellAmount, minBuyAmount);
        require(IERC20(sellToken).balanceOf(address(this)) - initialSellBal == sellAmount, "bad sell");
        require(IERC20(buyToken).balanceOf(address(this)) - initialBuyBal >= minBuyAmount, "bad buy");
        IERC20(sellToken).safeApprove(conf.exchange(), 0);
    }

    // function _tradeWithFixedBuyAmount(
    //     address sellToken,
    //     address buyToken,
    //     uint256 buyAmount,
    //     uint256 maxSellAmount
    // ) internal {
    //     uint256 initialSellBal = IERC20(sellToken).balanceOf(address(this));
    //     uint256 initialBuyBal = IERC20(buyToken).balanceOf(address(this));
    //     IERC20(sellToken).safeApprove(conf.exchange(), maxSellAmount);
    //     IAtomicExchange(conf.exchange()).tradeFixedBuy(sellToken, buyToken, buyAmount, maxSellAmount);
    //     require(IERC20(sellToken).balanceOf(address(this)) - initialSellBal <= maxSellAmount, "bad trade");
    //     require(IERC20(buyToken).balanceOf(address(this)) - initialBuyBal == buyAmount, "bad trade");
    //     IERC20(sellToken).safeApprove(conf.exchange(), 0);
    // }

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
            from != address(0) && 
            to != address(0) && 
            address(conf.txFee()) != address(0)
        ) {
            uint256 fee = ITXFee(conf.txFee()).calculateFee(from, to, amount);
            fee = Math.min(fee, amount * MAX_FEE / conf.SCALE());

            // Cheeky way of doing the fee without needing access to underlying _balances array
            _burn(from, fee);
            _mint(address(this), fee);
        }
    }

}
