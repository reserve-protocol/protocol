// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./deps/zeppelin/token/ERC20/utils/SafeERC20.sol";
import "./deps/zeppelin/token/ERC20/IERC20.sol";
import "./deps/zeppelin/access/Ownable.sol";
import "./deps/zeppelin/utils/math/Math.sol";
import "./interfaces/ITXFee.sol";
import "./interfaces/IRToken.sol";
import "./interfaces/IAtomicExchange.sol";
import "./interfaces/IInsurancePool.sol";
import "./interfaces/IConfiguration.sol";
import "./rtoken/SlowMintingERC20.sol";
import "./libraries/Basket.sol";
import "./SimpleOrderbookExchange.sol";

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
contract RToken is IRToken, Ownable, SlowMintingERC20 {
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
    modifier doPerBlockUpdates() {
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
            CollateralToken memory ct = basket.tokens[i];
            parts[i] = amount * ct.quantity / 10**decimals();
            parts[i] = parts[i] * (conf.SCALE() + conf.spreadScaled()) / conf.SCALE();
        }

        return parts;
    }


    /// The returned array will be in the same order as the current basket.
    function redemptionAmounts(uint256 amount) public view override returns (uint256[] memory) {
        uint256[] memory parts = new uint256[](basket.size);
        for (uint256 i = 0; i < basket.size; i++) {
            CollateralToken memory ct = basket.tokens[i];
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
            expected += basket.tokens[i].perBlockRateLimit;

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
        if (conf.txFeeAddress() == address(0)) {
            return 0;
        }

        return ITXFee(conf.txFeeAddress()).calculateAdjustedAmountToIncludeFee(from, to, amount);
    }

    /// =========================== External =================================


    /// Configuration changes, only callable by Owner.
    function changeConfiguration(address newConf) external override onlyOwner {
        emit ConfigurationChanged(address(conf), newConf);
        conf = IConfiguration(newConf);
        _updateBasket();
    }

    /// Callable by anyone, runs all the perBlockUpdates
    function act() external override doPerBlockUpdates {
        return;
    }

    /// Handles issuance.
    /// Requires approvals to be in place beforehand.
    function issue(uint256 amount) external override doPerBlockUpdates {
        require(amount > 0, "cannot issue zero RToken");
        require(amount < conf.maxSupply(), "at max supply");
        require(basket.size > 0, "basket cannot be empty");
        require(!ICircuitBreaker(conf.circuitBreakerAddress()).check(), "circuit breaker tripped");

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
    function redeem(uint256 amount) external override doPerBlockUpdates {
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
    function freezeTrading() external override doPerBlockUpdates {
        if (freezer != address(0)) {
            IERC20(conf.rsrTokenAddress()).safeTransfer(
                freezer,
                conf.tradingFreezeCost()
            );
        }

        IERC20(conf.rsrTokenAddress()).safeTransferFrom(
            _msgSender(),
            address(this),
            conf.tradingFreezeCost()
        );
        freezer = _msgSender();
        emit TradingFrozen(_msgSender());
    }

    /// Trading unfreeze
    function unfreezeTrading() external override doPerBlockUpdates {
        require(tradingFrozen(), "already unfrozen");
        require(_msgSender() == freezer, "only freezer can unfreeze");
        IERC20(conf.rsrTokenAddress()).safeTransfer(
            freezer,
            conf.tradingFreezeCost()
        );
        freezer = address(0);
        emit TradingUnfrozen(_msgSender());
    }

    /// =========================== Internal =================================

    /// Gets the quantity-adjusted basket from Configuration
    function _updateBasket() internal {
        basket.size = conf.getBasketSize();
        for (uint256 i = 0; i < conf.getBasketSize(); i++) {
            CollateralToken memory ct;
            (ct.tokenAddress, ct.quantity, ct.perBlockRateLimit) = conf.getBasketTokenAdjusted(i);
            basket.tokens[i] = ct;
        }
    }

    /// Expands the RToken supply and gives the new mintings to the protocol fund and 
    /// the insurance pool.
    function _expandSupply() internal {
        // 31536000 = seconds in a year
        uint256 toExpand = totalSupply() * conf.supplyExpansionRateScaled() * (block.timestamp - lastTimestamp) / 31536000 / conf.SCALE() ;
        if (toExpand == 0) {
            return;
        }
        lastTimestamp = block.timestamp;

        // Mint to protocol fund
        if (conf.expenditureFactorScaled() > 0) {
            uint256 e = toExpand * Math.min(conf.SCALE(), conf.expenditureFactorScaled()) / conf.SCALE();
            _mint(conf.protocolFundAddress(), e);
        }

        // Mint to self
        if (conf.expenditureFactorScaled() < conf.SCALE()) {
            uint256 p = toExpand * (conf.SCALE() - conf.expenditureFactorScaled()) / conf.SCALE();
            _mint(address(this), p);
        }

        // Batch transfers from self to InsurancePool
        if (balanceOf(address(this)) > totalSupply() * conf.revenueBatchSizeScaled() / conf.SCALE()) {
            _approve(address(this), conf.insurancePoolAddress(), balanceOf(address(this)));
            IInsurancePool(conf.insurancePoolAddress()).notifyRevenue(balanceOf(address(this)));
        }
    }

    /// Trades tokens against the IAtomicExchange with per-block rate limiting
    function _rebalance() internal {
        uint256 numBlocks = block.number - lastBlock;
        if (tradingFrozen() || numBlocks == 0) { 
            return; 
        }
        lastBlock = block.number;

        int256 indexLowest = leastCollateralized();
        int256 indexHighest = mostCollateralized();
        IAtomicExchange exchange = IAtomicExchange(conf.exchangeAddress());

        if (indexLowest >= 0 && indexHighest >= 0) {
            CollateralToken storage ctLow = basket.tokens[uint256(indexLowest)];
            CollateralToken storage ctHigh = basket.tokens[uint256(indexHighest)];
            uint256 sellAmount = Math.min(numBlocks * ctHigh.perBlockRateLimit, IERC20(ctHigh.tokenAddress).balanceOf(address(this)) - totalSupply() * ctHigh.quantity / 10**(decimals()));
            _trade(ctHigh.tokenAddress, ctLow.tokenAddress, sellAmount);
        } else if (indexLowest >= 0) {
            CollateralToken storage ctLow = basket.tokens[uint256(indexLowest)];
            uint256 sellAmount = numBlocks * conf.rsrSellRate();
            uint256 seized = IInsurancePool(conf.insurancePoolAddress()).seizeRSR(sellAmount);
            IERC20(conf.rsrTokenAddress()).safeApprove(conf.exchangeAddress(), seized);
            _trade(conf.rsrTokenAddress(), ctLow.tokenAddress, seized);
        } else if (indexHighest >= 0) {
            CollateralToken storage ctHigh = basket.tokens[uint256(indexHighest)];
            uint256 sellAmount = Math.min(numBlocks * ctHigh.perBlockRateLimit, IERC20(ctHigh.tokenAddress).balanceOf(address(this)) - totalSupply() * ctHigh.quantity / 10**(decimals()));
            IERC20(ctHigh.tokenAddress).safeApprove(conf.exchangeAddress(), sellAmount);
            _trade(ctHigh.tokenAddress, conf.rsrTokenAddress(), sellAmount);
        }

    }

    function _trade(
        address sellToken, 
        address buyToken, 
        uint256 sellAmount
    ) internal {
        // uint256 initialBal = IERC20(buyToken).balanceOf(address(this));
        IAtomicExchange(conf.exchangeAddress()).trade(sellToken, buyToken, sellAmount);
        // require(IERC20(buyToken).balanceOf(address(this)) - initialBal >= minBuy, "bad trade");
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
            from != address(0) && 
            to != address(0) && 
            address(conf.txFeeAddress()) != address(0)
        ) {
            uint256 fee = ITXFee(conf.txFeeAddress()).calculateFee(from, to, amount);
            fee = Math.min(fee, amount * MAX_FEE / conf.SCALE());

            // Cheeky way of doing the fee without needing access to underlying _balances array
            _burn(from, fee);
            _mint(address(this), fee);
        }
    }
}
