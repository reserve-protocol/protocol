// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title SlowMintingFacet
 * @dev An ERC-20 token with built-in rules for price stabilization centered around a s.basket.
 *
 * RTokens can:
 *    - scale up or down in supply (nearly) completely elastically
 *    - change their backing while maintaining price
 *    - and, recover from collateral defaults through insurance
 *
 */
contract IssuanceFacet is Context  {
    using Token for Token.Info;
    using Basket for Basket.Info;

    AppStorage internal s;

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

    /// Handles issuance.
    /// Requires approvals to be in place beforehand.
    function issue(uint256 amount) external override everyBlock {
        require(amount > s.minMintingSize, "cannot issue less than minMintingSize");
        require(s.basket.size > 0, "basket cannot be empty");
        require(!ICircuitBreaker(address(this)).check(), "circuit breaker tripped");

        uint256[] memory amounts = issueAmounts(amount);
        for (uint16 i = 0; i < s.basket.size; i++) {
            s.basket.tokens[i].safeTransferFrom(
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
        require(s.basket.size > 0, "basket cannot be empty");

        uint256[] memory amounts = redemptionAmounts(amount);
        _burn(_msgSender(), amount);
        for (uint16 i = 0; i < s.basket.size; i++) {
            s.basket.tokens[i].safeTransfer(_msgSender(), amounts[i]);
        }

        emit Redemption(_msgSender(), amount);
    }

    /// Trading freeze
    function freezeTrading() external override {
        if (tradingFrozen()) {
            rsr.safeTransfer(freezer, s.tradingFreezeCost);
        }

        rsr.safeTransferFrom(_msgSender(), address(this), s.tradingFreezeCost);
        freezer = _msgSender();
        emit TradingFrozen(_msgSender());
    }

    /// Trading unfreeze
    function unfreezeTrading() external override {
        require(tradingFrozen(), "already unfrozen");
        require(_msgSender() == freezer, "only freezer can unfreeze");

        rsr.safeTransfer(freezer, s.tradingFreezeCost);
        freezer = address(0);
        emit TradingUnfrozen(_msgSender());
    }

    /// =========================== Views =================================

    function tradingFrozen() public view override returns (bool) {
        return freezer != address(0);
    }

    function issueAmounts(uint256 amount) public view returns (uint256[] memory parts) {
        parts = new uint256[](s.basket.size);
        for (uint16 i = 0; i < s.basket.size; i++) {
            parts[i] = (amount * s.basket.tokens[i].adjustedQuantity) / 10**decimals();
            parts[i] = (parts[i] * (1e18 + s.spread)) / 1e18;
        }
    }

    function redemptionAmounts(uint256 amount) public view returns (uint256[] memory parts) {
        parts = new uint256[](s.basket.size);
        bool isFullyCollateralized = _leastCollateralized() == -1;

        for (uint16 i = 0; i < s.basket.size; i++) {
            if (isFullyCollateralized) {
                parts[i] = (s.basket.tokens[i].adjustedQuantity * amount) / 10**decimals();
            } else {
                parts[i] = (s.tokens[i].getBalance() * amount) / totalSupply();
            }
        }
    }

    /// =========================== Internal =================================

    /// Sets the adjusted basket quantities for the current block 
    function _updateBasket() internal {
        for (uint16 i = 0; i < s.basket.size; i++) {
            s.basket.tokens[i].adjustQuantity(1e18, s.supplyExpansionRate, _deployedAt);
        }
    }

    /// Tries to process up to a fixed number of mintings. Called before most actions.
    function _tryProcessMintings() internal {
        if (!ICircuitBreaker(s.circuitBreaker).check()) {
            uint256 start = currentMinting;
            uint256 blocksSince = block.number - _lastBlock;
            uint256 issuanceAmount = s.issuanceRate;
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

                uint256 blocksUsed = m.amount / s.issuanceRate;
                if (blocksUsed * s.issuanceRate > m.amount) {
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
            s.supplyExpansionRate *
            (block.timestamp - _lastTimestamp)) /
            31536000 /
            1e18;
        _lastTimestamp = block.timestamp;
        if (toExpand == 0) {
            return;
        }

        // Mint to protocol fund
        if (s.expenditureFactor > 0) {
            uint256 e = (toExpand * Math.min(1e18, s.expenditureFactor)) /
                1e18;
                (s.protocolFund, e);
        }

        // Mint to self
        if (s.expenditureFactor < 1e18) {
            uint256 p = (toExpand * (1e18 - s.expenditureFactor)) / 1e18;
            _mint(address(this), p);
        }

        // Batch transfers from self to InsurancePool
        if (balanceOf(address(this)) > (totalSupply() * s.revenueBatchSize) / 1e18) {
            _approve(address(this), s.insurancePool, balanceOf(address(this)));
            IInsurancePool(s.insurancePool).notifyRevenue(false, balanceOf(address(this)));
        }
    }

    /// Trades tokens against the IAtomicExchange with per-block rate limiting
    function _rebalance() internal {
        uint256 numBlocks = block.number - _lastBlock;
        _lastBlock = block.number;
        if (tradingFrozen() || numBlocks == 0) {
            return;
        }

        int32 indexLowest = _leastCollateralized();
        int32 indexHighest = _mostCollateralized();

        /// Three cases:
        /// 1. Sideways: Trade collateral for collateral
        /// 2. Sell RSR: Trade RSR for collateral
        /// 3. Buyback RSR: Trade collateral for RSR
        if (indexLowest >= 0 && indexHighest >= 0) {
            // Sell as much excess collateral as possible for missing collateral

            Token.Info storage lowToken = s.basket.tokens[uint16(uint32(indexLowest))];
            Token.Info storage highToken = s.basket.tokens[uint16(uint32(indexHighest))];
            uint256 sell = Math.min(highToken.maxTrade, Math.min(
                numBlocks * highToken.rateLimit,
                highToken.getBalance() - (totalSupply * highToken.adjustedQuantity) / 10**decimals
            ));
            uint256 minBuy = (sell * lowToken.priceInRToken) / highToken.priceInRToken;
            minBuy = (minBuy * Math.min(lowToken.slippageTolerance, 1e18)) / 1e18;
            minBuy = (minBuy * Math.min(highToken.slippageTolerance, 1e18)) / 1e18;
            _tradeWithFixedSellAmount(highToken, lowToken, sell, minBuy);
        } else if (indexLowest >= 0) {
            // 1. Seize RSR from the insurance pool
            // 2. Trade some-to-all of the seized RSR for missing collateral
            // 3. Return any leftover RSR

            Token.Info storage lowToken = s.basket.tokens[uint16(uint32(indexLowest))];
            uint256 toSeize = Math.min(numBlocks * rsr.rateLimit, rsr.maxTrade);
            uint256 sell = IInsurancePool(s.insurancePool).seizeRSR(toSeize);
            uint256 minBuy = (sell * lowToken.priceInRToken) / rsr.priceInRToken;
            minBuy = (minBuy * Math.min(lowToken.slippageTolerance, 1e18)) / 1e18;
            minBuy = (minBuy * Math.min(rsr.slippageTolerance, 1e18)) / 1e18;
            _tradeWithFixedSellAmount(rsr, lowToken, sell, minBuy);

            // Clean up any leftover RSR
            if (rsr.getBalance() > 0) {
                rsr.safeApprove(s.insurancePool, rsr.getBalance());
                IInsurancePool(s.insurancePool).notifyRevenue(true, rsr.getBalance());
                rsr.safeApprove(s.insurancePool, 0);
            }
        } else if (indexHighest >= 0) {
            // Sell as much excess collateral as possible for RSR

            Token.Info storage highToken = s.basket.tokens[uint16(uint32(indexHighest))];
            uint256 sell = Math.min(numBlocks * highToken.rateLimit, highToken.maxTrade);
            uint256 minBuy = (sell * rsr.priceInRToken) / highToken.priceInRToken;
            minBuy = (minBuy * Math.min(highToken.slippageTolerance, 1e18)) / 1e18;
            minBuy = (minBuy * Math.min(rsr.slippageTolerance, 1e18)) / 1e18;
            _tradeWithFixedSellAmount(highToken, rsr, sell, minBuy);
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
        sellToken.safeApprove(s.exchange, sellAmount);
        IAtomicExchange(s.exchange).tradeFixedSell(
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
        sellToken.safeApprove(s.exchange, 0);
    }

    /// Returns index of least collateralized token, or -1 if fully collateralized.
    function _leastCollateralized() internal view returns (int32) {
        uint256 largestDeficitNormed;
        int32 index = -1;

        for (uint16 i = 0; i < s.basket.size; i++) {
            uint256 bal = s.basket.tokens[i].getBalance();
            uint256 expected = (totalSupply() * s.basket.tokens[i].adjustedQuantity) / 10**decimals();

            if (bal < expected) {
                uint256 deficitNormed = (expected - bal) / s.basket.tokens[i].adjustedQuantity;
                if (deficitNormed > largestDeficitNormed) {
                    largestDeficitNormed = deficitNormed;
                    index = int32(uint32(i));
                }
            }
        }
        return index;
    }

    /// Returns the index of the most collateralized token, or -1.
    function _mostCollateralized() internal view returns (int32) {
        uint256 largestSurplusNormed;
        int32 index = -1;

        for (uint16 i = 0; i < s.basket.size; i++) {
            uint256 bal = s.basket.tokens[i].getBalance();
            uint256 expected = (totalSupply() * s.basket.tokens[i].adjustedQuantity) / 10**decimals();
            expected += s.basket.tokens[i].rateLimit;

            if (bal > expected) {
                uint256 surplusNormed = (bal - expected) / s.basket.tokens[i].adjustedQuantity;
                if (surplusNormed > largestSurplusNormed) {
                    largestSurplusNormed = surplusNormed;
                    index = int32(uint32(i));
                }
            }
        }
        return index;
    }
}
