// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "../libraries/Storage.sol";

/**
 * @title SlowMintingFacet
 * @dev An ERC-20 token with built-in rules for price stabilization centered around a basket.
 *
 * RTokens can:
 *    - scale up or down in supply (nearly) completely elastically
 *    - change their backing while maintaining price
 *    - and, recover from collateral defaults through insurance
 *
 */
contract IssuanceFacet is Context, IIssuance {
    using DiamondStorage for DiamondStorage.Info;
    using Token for Token.Info;
    using Basket for Basket.Info;

    DiamondStorage.Info internal ds;

    struct Minting {
        uint256 amount;
        address account;
    }

    struct IssuanceStorage {
        Minting[] mintings;
        uint256 currentMinting;
        uint256 lastBlock;
        uint256 lastTimestamp;
        address freezer;

        /// ==== Governance Params ====
        /// Minimum minting amount
        /// e.g. 1_000e18 => 1k RToken 
        uint256 minMintingSize;
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
        /// Recipient of expenditure outflow
        address protocolFund;
    }


    constructor () {
        s.lastBlock = block.number;
        s.lastTimestamp = block.timestamp;
    }

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

    function noop() external override everyBlock {}

    /// Handles issuance.
    /// Requires approvals to be in place beforehand.
    function issue(uint256 amount) external override everyBlock {
        IssuanceStorage storage s = ds.issuanceStorage();
        require(amount > s.minMintingSize, "cannot issue less than minMintingSize");
        require(ds.basket.size > 0, "basket cannot be empty");
        require(!ICircuitBreaker(address(this)).check(), "circuit breaker tripped");

        uint256[] memory amounts = issueAmounts(amount);
        for (uint16 i = 0; i < ds.basket.size; i++) {
            ds.basket.tokens[i].safeTransferFrom(
                _msgSender(),
                address(this),
                amounts[i]
            );
        }

        // puts minting on the queue
        _startSlowMinting(s, _msgSender(), amount);
    }

    /// Handles redemption.
    function redeem(uint256 amount) external override everyBlock {
        IssuanceStorage storage s = ds.issuanceStorage();
        require(amount > 0, "cannot redeem 0 RToken");
        require(ds.basket.size > 0, "basket cannot be empty");

        uint256[] memory amounts = redemptionAmounts(amount);
        _burn(_msgSender(), amount);
        for (uint16 i = 0; i < ds.basket.size; i++) {
            ds.basket.tokens[i].safeTransfer(_msgSender(), amounts[i]);
        }

        emit Redemption(_msgSender(), amount);
    }

    /// Trading freeze
    function freezeTrading() external override {
        IssuanceStorage storage s = ds.issuanceStorage();
        if (tradingFrozen(is)) {
            ds.rsr.safeTransfer(s.freezer, s.tradingFreezeCost);
        }

        ds.rsr.safeTransferFrom(_msgSender(), address(this), s.tradingFreezeCost);
        s.freezer = _msgSender();
        emit TradingFrozen(_msgSender());
    }

    /// Trading unfreeze
    function unfreezeTrading() external override {
        IssuanceStorage storage s = ds.issuanceStorage();
        require(tradingFrozen(is), "already unfrozen");
        require(_msgSender() == s.freezer, "only freezer can unfreeze");

        ds.rsr.safeTransfer(s.freezer, s.tradingFreezeCost);
        s.freezer = address(0);
        emit TradingUnfrozen(_msgSender());
    }

    /// =========================== Views =================================

    function tradingFrozen() public view override returns (bool) {
        IssuanceStorage storage s = ds.issuanceStorage();
        return _tradingFrozen(is);
    }


    function issueAmounts(uint256 amount) public view returns (uint256[] memory parts) {
        return _issueAmounts(ds.issuanceStorage(), amount);
    }

    function redemptionAmounts(uint256 amount) public view returns (uint256[] memory parts) {
        return _redemptionAmounts(ds.issuanceStorage(), amount);
    }

    /// =========================== Internal =================================

    function _tradingFrozen(IssuanceStorage storage s) internal view override returns (bool) {
        return s.freezer != address(0);
    }

    /// Sets the adjusted basket quantities for the current block 
    function _updateBasket(IssuanceStorage storage s) internal {
        for (uint16 i = 0; i < ds.basket.size; i++) {
            ds.basket.tokens[i].adjustQuantity(1e18, s.supplyExpansionRate, ds.timestampDeployed);
        }
    }


    function _issueAmounts(IssuanceStorage storage s, uint256 amount) internal view returns (uint256[] memory parts) {
        parts = new uint256[](ds.basket.size);
        for (uint16 i = 0; i < ds.basket.size; i++) {
            parts[i] = (amount * ds.basket.tokens[i].adjustedQuantity) / 10**decimals();
            parts[i] = (parts[i] * (1e18 + s.spread)) / 1e18;
        }
    }

    function _redemptionAmounts(IssuanceStorage storage s, uint256 amount) internal view returns (uint256[] memory parts) {
        parts = new uint256[](ds.basket.size);
        bool isFullyCollateralized = _leastCollateralized() == -1;
        IERC20 self = IERC20(address(this));

        for (uint16 i = 0; i < ds.basket.size; i++) {
            if (isFullyCollateralized) {
                parts[i] = (ds.basket.tokens[i].adjustedQuantity * amount) / 10**self.decimals();
            } else {
                parts[i] = (ds.basket.tokens[i].getBalance() * amount) / self.totalSupply();
            }
        }
    }

    /// Tries to process up to a fixed number of mintings. Called before most actions.
    function _tryProcessMintings(IssuanceStorage storage s) internal {
        if (!ICircuitBreaker(address(this)).check()) {
            uint256 start = s.currentMinting;
            uint256 blocksSince = block.number - s.lastBlock;
            uint256 issuanceAmount = s.issuanceRate;
            while (s.currentMinting < s.mintings.length && s.currentMinting < start + 10000) {
                // TODO: Tune the +10000 maximum. Might have to be smaller.
                Minting storage m = s.mintings[s.currentMinting];

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

                uint256 blocksUsed = m.amount /s.issuanceRate;
                if (blocksUsed *s.issuanceRate > m.amount) {
                    blocksUsed = blocksUsed + 1;
                }
                blocksSince = blocksSince - blocksUsed;
               
                delete s.mintings[s.currentMinting]; // gas saving..?
                
                s.currentMinting++;
            }
            
            // update s.lastBlock if tokens were minted
            if(s.currentMinting > start) {
                s.lastBlock = block.number;
            }        
        }
    }

    /// Expands the RToken supply and gives the new s.mintings to the protocol fund and
    /// the insurance pool.
    function _expandSupply(IssuanceStorage storage s) internal {
        // 31536000 = seconds in a year
        uint256 toExpand = (totalSupply() *
           s.supplyExpansionRate *
            (block.timestamp - s.lastTimestamp)) /
            31536000 /
            1e18;
        s.lastTimestamp = block.timestamp;
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
        if (balanceOf(address(this)) > (totalSupply() *s.revenueBatchSize) / 1e18) {
            _approve(address(this), s.insurancePool, balanceOf(address(this)));
            IInsurancePool(address(this)).notifyRevenue(false, balanceOf(address(this)));
        }
    }

    /// Trades tokens against the IDEXRouter with per-block rate limiting
    function _rebalance(IssuanceStorage storage s) internal {
        uint256 numBlocks = block.number - s.lastBlock;
        s.lastBlock = block.number;
        if (_tradingFrozen(s) || numBlocks == 0) {
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

            Token.Info storage lowToken = ds.basket.tokens[uint16(uint32(indexLowest))];
            Token.Info storage highToken = ds.basket.tokens[uint16(uint32(indexHighest))];
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

            Token.Info storage lowToken = ds.basket.tokens[uint16(uint32(indexLowest))];
            uint256 toSeize = Math.min(numBlocks * ds.rsr.rateLimit, ds.rsr.maxTrade);
            uint256 sell = IInsurancePool(s.insurancePool).seizeRSR(toSeize);
            uint256 minBuy = (sell * lowToken.priceInRToken) / ds.rsr.priceInRToken;
            minBuy = (minBuy * Math.min(lowToken.slippageTolerance, 1e18)) / 1e18;
            minBuy = (minBuy * Math.min(ds.rsr.slippageTolerance, 1e18)) / 1e18;
            _tradeWithFixedSellAmount(rsr, lowToken, sell, minBuy);

            // Clean up any leftover RSR
            if (ds.rsr.getBalance() > 0) {
                ds.rsr.safeApprove(s.insurancePool, ds.rsr.getBalance());
                IInsurancePool(s.insurancePool).notifyRevenue(true, ds.rsr.getBalance());
                ds.rsr.safeApprove(s.insurancePool, 0);
            }
        } else if (indexHighest >= 0) {
            // Sell as much excess collateral as possible for RSR

            Token.Info storage highToken = ds.basket.tokens[uint16(uint32(indexHighest))];
            uint256 sell = Math.min(numBlocks * highToken.rateLimit, highToken.maxTrade);
            uint256 minBuy = (sell * ds.rsr.priceInRToken) / highToken.priceInRToken;
            minBuy = (minBuy * Math.min(highToken.slippageTolerance, 1e18)) / 1e18;
            minBuy = (minBuy * Math.min(ds.rsr.slippageTolerance, 1e18)) / 1e18;
            _tradeWithFixedSellAmount(highToken, rsr, sell, minBuy);
        }
    }

    /// Starts a slow minting
    function _startSlowMinting(IssuanceStorage storage s, address account, uint256 amount) internal {
        require(account != address(0), "ERC20: mint to the zero address");
        require(amount > 0, "cannot mint 0");

        Minting memory m = Minting(amount, account);
        s.mintings.push(m);

        // update s.lastBlock if this is the only item in queue
        if (s.mintings.length == s.currentMinting + 1) {
            s.lastBlock = block.number;
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
        IDEXRouter(address(this)).tradeFixedSell(
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
    }

    /// Returns index of least collateralized token, or -1 if fully collateralized.
    function _leastCollateralized() internal view returns (int32) {
        uint256 largestDeficitNormed;
        int32 index = -1;
        IERC20 self = IERC20(address(this));

        for (uint16 i = 0; i < ds.basket.size; i++) {
            uint256 bal = ds.basket.tokens[i].getBalance();
            uint256 expected = (self.totalSupply() * ds.basket.tokens[i].adjustedQuantity) / 10**self.decimals();

            if (bal < expected) {
                uint256 deficitNormed = (expected - bal) / ds.basket.tokens[i].adjustedQuantity;
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
        IERC20 self = IERC20(address(this));

        for (uint16 i = 0; i < ds.basket.size; i++) {
            uint256 bal = ds.basket.tokens[i].getBalance();
            uint256 expected = (self.totalSupply() * ds.basket.tokens[i].adjustedQuantity) / 10**self.decimals();
            expected += ds.basket.tokens[i].rateLimit;

            if (bal > expected) {
                uint256 surplusNormed = (bal - expected) / ds.basket.tokens[i].adjustedQuantity;
                if (surplusNormed > largestSurplusNormed) {
                    largestSurplusNormed = surplusNormed;
                    index = int32(uint32(i));
                }
            }
        }
        return index;
    }
}
