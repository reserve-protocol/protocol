// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./Token.sol";
import "./Basket.sol";

struct RTokenConfig {

    /// RSR staking deposit delay (s)
    /// e.g. 2_592_000 => Newly staked RSR tokens take 1 month to enter the insurance pool
    uint256 stakingDepositDelay;
    /// RSR staking withdrawal delay (s)
    /// e.g. 2_592_000 => Currently staking RSR tokens take 1 month to withdraw
    uint256 stakingWithdrawalDelay;
    /// RToken max supply
    /// e.g. 1_000_000e18 => 1M max supply
    uint256 maxSupply;
    /// RToken annual supply-expansion rate, scaled
    /// e.g. 1.23e16 => 1.23% annually
    uint256 supplyExpansionRate;
    /// RToken revenue batch sizes
    /// e.g. 1e15 => 0.1% of the RToken supply
    uint256 revenueBatchSize;
    /// Protocol expenditure factor
    /// e.g. 1e16 => 1% of the RToken supply expansion goes to protocol fund
    uint256 expenditureFactor;
    /// Issuance/Redemption spread
    /// e.g. 1e14 => 0.01% spread
    uint256 spread;
    /// RToken issuance blocklimit
    /// e.g. 25_000e18 => 25_000e18 (atto)RToken can be issued per block
    uint256 issuanceRate;
    /// Cost of freezing trading (in RSR)
    /// e.g. 100_000_000e18 => 100M RSR
    uint256 tradingFreezeCost;

    /// Contract Addresses
    address circuitBreaker;
    address txFeeCalculator;
    address insurancePool;
    address protocolFund;
    address exchange;
}


/**
 * @title RTokenManager
 */
library RTokenManager {
    using SafeERC20 for IERC20;

    function isFullyCollateralized(AppStorage storage s, uint256 totalSupply, uint8 decimals) internal view returns (bool) {
        for (uint256 i = 0; i < s.basket.size; i++) {
            uint256 expected = (totalSupply * s.basket.tokens[i].quantity) / 10**decimals;
            if (IERC20(s.basket.tokens[i].tokenAddress).balanceOf(address(this)) < expected) {
                return false;
            }
        }
        return true;
    }

    /// The returned array will be in the same order as the current s.basket.
    function issueAmounts(AppStorage storage s, uint256 amount) internal view returns (uint256[] memory) {
        uint256[] memory parts = new uint256[](s.basket.size);
        for (uint256 i = 0; i < s.basket.size; i++) {
            Token memory ct = s.basket.tokens[i];
            parts[i] = (amount * ct.quantity) / 10**decimals();
            parts[i] = (parts[i] * (conf.SCALE() + conf.spread())) / conf.SCALE();
        }

        return parts;
    }

    /// The returned array will be in the same order as the current s.basket.
    function redemptionAmounts(AppStorage storage s, uint256 amount) internal view returns (uint256[] memory) {
        uint256[] memory parts = new uint256[](s.basket.size);
        for (uint256 i = 0; i < s.basket.size; i++) {
            Token memory ct = s.basket.tokens[i];
            uint256 bal = IERC20(ct.tokenAddress).balanceOf(address(this));
            if (isFullyCollateralized()) {
                parts[i] = (ct.quantity * amount) / 10**decimals();
            } else {
                parts[i] = (bal * amount) / totalSupply();
            }
        }

        return parts;
    }

    /// Returns index of least collateralized token, or -1 if fully collateralized.
    function leastCollateralized(AppStorage storage s) internal view returns (int256) {
        uint256 largestDeficitNormed;
        int256 index = -1;

        for (uint256 i = 0; i < s.basket.size; i++) {
            uint256 bal = IERC20(s.basket.tokens[i].tokenAddress).balanceOf(address(this));
            uint256 expected = (s.totalSupply * s.basket.tokens[i].quantity) / 10**s.decimals;

            if (bal < expected) {
                uint256 deficitNormed = (expected - bal) / s.basket.tokens[i].quantity;
                if (deficitNormed > largestDeficitNormed) {
                    largestDeficitNormed = deficitNormed;
                    index = int256(i);
                }
            }
        }
        return index;
    }

    /// Returns the index of the most collateralized token, or -1.
    function mostCollateralized() internal view returns (int256) {
        uint256 largestSurplusNormed;
        int256 index = -1;

        for (uint256 i = 0; i < s.basket.size; i++) {
            uint256 bal = IERC20(s.basket.tokens[i].tokenAddress).balanceOf(address(this));
            uint256 expected = (totalSupply() * s.basket.tokens[i].quantity) / 10**decimals();
            expected += s.basket.tokens[i].rateLimit;

            if (bal > expected) {
                uint256 surplusNormed = (bal - expected) / s.basket.tokens[i].quantity;
                if (surplusNormed > largestSurplusNormed) {
                    largestSurplusNormed = surplusNormed;
                    index = int256(i);
                }
            }
        }
        return index;
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
            uint256 e = (toExpand * Math.min(conf.SCALE(), conf.expenditureFactor())) /
                conf.SCALE();
            _mint(conf.protocolFund(), e);
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

            Token storage lowToken = s.basket.tokens[uint256(indexLowest)];
            Token storage highToken = s.basket.tokens[uint256(indexHighest)];
            uint256 sell = Math.min(
                numBlocks * highToken.rateLimit,
                IERC20(highToken.tokenAddress).balanceOf(address(this)) -
                    (totalSupply() * highToken.quantity) /
                    10**decimals()
            );
            uint256 minBuy = (sell * lowToken.priceInRToken) / highToken.priceInRToken;
            minBuy = (minBuy * Math.min(lowToken.slippageTolerance, conf.SCALE())) / conf.SCALE();
            minBuy = (minBuy * Math.min(highToken.slippageTolerance, conf.SCALE())) / conf.SCALE();
            _tradeWithFixedSellAmount(highToken.tokenAddress, lowToken.tokenAddress, sell, minBuy);
        } else if (indexLowest >= 0) {
            // 1. Seize RSR from the insurance pool
            // 2. Trade some-to-all of the seized RSR for missing collateral
            // 3. Return any leftover RSR

            Token storage lowToken = s.basket.tokens[uint256(indexLowest)];
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
            minBuy = (minBuy * Math.min(lowToken.slippageTolerance, conf.SCALE())) / conf.SCALE();
            minBuy = (minBuy * Math.min(rsrSlippageTolerance, conf.SCALE())) / conf.SCALE();
            _tradeWithFixedSellAmount(rsrAddress, lowToken.tokenAddress, sell, minBuy);

            // Clean up any leftover RSR
            uint256 rsrBalance = IERC20(rsrAddress).balanceOf(address(this));
            if (rsrBalance > 0) {
                IERC20(rsrAddress).safeApprove(conf.insurancePool(), rsrBalance);
                IInsurancePool(conf.insurancePool()).notifyRevenue(true, rsrBalance);
            }
        } else if (indexHighest >= 0) {
            // Sell as much excess collateral as possible for RSR

            Token storage highToken = s.basket.tokens[uint256(indexHighest)];
            (address rsrAddress, , , uint256 rsrPriceInRToken, uint256 rsrSlippageTolerance) = conf
            .insuranceToken();
            uint256 sell = numBlocks * highToken.rateLimit;
            uint256 minBuy = (sell * rsrPriceInRToken) / highToken.priceInRToken;
            minBuy = (minBuy * Math.min(highToken.slippageTolerance, conf.SCALE())) / conf.SCALE();
            minBuy = (minBuy * Math.min(rsrSlippageTolerance, conf.SCALE())) / conf.SCALE();
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
            uint256 fee = Math.min(amount, ITXFee(conf.txFeeCalculator()).calculateFee(from, to, amount));

            // Cheeky way of doing the fee without needing access to underlying _balances array
            _burn(from, fee);
            _mint(address(this), fee);
        }
    }
}
