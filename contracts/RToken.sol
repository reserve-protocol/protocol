pragma solidity 0.8.4;

import "../zeppelin/token/ERC20/utils/SafeERC20.sol";
import "../zeppelin/token/IERC20.sol";
import "../zeppelin/access/Ownable.sol";
import "../interfaces/IConfiguration.sol";
import "../interfaces/ITXFee.sol";
import "../interfaces/IRToken.sol";
import "../interfaces/IAuctionManager.sol";
import "../interfaces/IInsurancePool.sol";
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
 * Only the owner (which should be set to a TimelockController) can change the Configuration.
 */
contract RToken is IRToken, SlowMintingERC20, Ownable {
    using SafeERC20 for IERC20;

    /// ==== Immutable State ====

    IAuctionManager public immutable override auctionManager;

    /// Max Fee on transfers, ever
    uint256 public constant override MAX_FEE = 5e16; // 5%

    /// ==== Mutable State ====

    IConfiguration public override conf;

    /// since last
    uint128 private override lastTimestamp;
    uint128 private override lastBlock;

    /// Global settlement state
    bool public override dead = false;

    constructor(
        address calldata owner_,
        string calldata name_, 
        string calldata symbol_, 
        address calldata conf_,
    ) ERC20SlowMint(name_, symbol_, conf_) public {
        _owner = owner_;
        auctionManager = new AuctionManager();
    }

    /// Called at the start of every public view and external

    modifier circuitBreakerUnpaused() {
        bool tripped = ICircuitBreaker(conf.circuitBreakerAddress).check();
        require(!tripped, "circuit breaker tripped");
        _;
    }
    
    modifier isAlive() {
        require(!dead, "global settlement has occurred, please redeem");
        _;
    }

    /// =========================== External =================================


    /// Callable only by the auction manager
    function update() external override {
        require(_msgSender() == address(auctionManager), "must be auction manager");
        _update();
    }

    /// Configuration changes, only callable by Owner.
    function changeConfiguration(address newConf) external override isAlive expandSupply onlyOwner {
        conf = IConfiguration(newConf);
    }

    /// Adaptation function, callable by anyone
    function act() external override isAlive expandSupply rebalance {

    }

    /// Handles issuance.
    /// Requires approvals to be in place beforehand.
    function issue(uint256 amount) external override isAlive expandSupply circuitBreakerUnpaused {
        require(amount > 0, "cannot issue zero RToken");
        require(amount < conf.maxSupply, "at max supply");
        require(conf.basket.length > 0, "basket cannot be empty");

        uint256[] memory amounts = issueAmounts(amount);
        for (uint32 i = 0; i < conf.basket.length; i++) {
            IERC20(conf.basket.tokens[i].address).safeTransferFrom(
                _msgSender(),
                address(this),
                amounts[i]
            );
        }

        _mint(_msgSender(), amount);
        emit Issuance(_msgSender(), amount);
    }

    /// Handles redemption.
    function redeem(uint256 amount) external override expandSupply {
        require(amount > 0, "cannot redeem 0 RToken");
        require(conf.basket.length > 0, "basket cannot be empty");


        uint256[] memory amounts = redemptionAmounts(amount);
        _burn(_msgSender(), amount);
        for (uint32 i = 0; i < conf.basket.length; i++) {
            IERC20(conf.basket.tokens[i].address).safeTransfer(
                _msgSender(),
                amounts[i]
            );
        }

        emit Redemption(_msgSender(), amount);
    }

    /// Global Settlement
    function kill() external override isAlive expandSupply {
        IERC20(conf.rsrTokenAddress).safeTransferFrom(
            _msgSender(),
            address(0),
            conf.globalSettlementCost
        );
        dead = true;
        emit Killed(_msgSender());
    }

    /// =========================== Views =================================

    /// Returns index of least collateralized token, or -1 if fully collateralized.
    function leastCollateralized() public view returns (int32) {
        uint256 largestDeficitNormed;
        int32 index = -1;

        for (uint32 i = 0; i < conf.basket.length; i++) {
            uint256 bal = IERC20(conf.basket.tokens[i].address).balanceOf(address(this));
            uint256 expected = _totalSupply * conf.basket.tokens[i].quantity / 10**decimals();

            if (bal < expected) {
                uint256 deficitNormed = (expected - bal) / conf.basket.tokens[i].quantity;
                if (deficitNormed > largestDeficit)Normed {
                    largestDeficitNormed = deficitNormed;
                    index = i;
                }
            }
        }
        return index;
    }

    /// Returns the index of the most collateralized token, or -1.
    function mostCollateralized() public view returns (int32) {
        uint256 largestSurplusNormed;
        int32 index = -1;

        for (uint32 i = 0; i < conf.basket.length; i++) {
            uint256 bal = IERC20(conf.basket.tokens[i].address).balanceOf(address(this));
            uint256 expected = _totalSupply * conf.basket.tokens[i].quantity / 10**decimals();
            expected += conf.basket.tokens[i].sellRatePerBlock;

            if (bal > expected) {
                uint256 surplusNormed = (bal - expected) / conf.basket.tokens[i].quantity;
                if (surplusNormed > largestSurplusNormed) {
                    largestSurplusNormed = surplusNormed;
                    index = i;
                }
            }
        }
        return index;
    }

    /// The returned array will be in the same order as the current basket.
    function issueAmounts(uint256 amount) public view returns (uint256[] memory) {
        uint256[] memory parts = new uint256[](conf.basket.length);

        for (uint32 i = 0; i < conf.basket.length; i++) {
            parts[i] = amount * conf.basket.tokens[i].quantity / 10**decimals();
            parts[i] = parts[i] * (conf.SCALE + conf.spread) / conf.SCALE;
        }

        return parts;
    }


    /// The returned array will be in the same order as the current basket.
    function redemptionAmounts(uint256 amount) public view returns (uint256[] memory) {
        uint256[] memory parts = new uint256[](conf.basket.length);

        bool fullyCollateralized = fullyCollateralized();
        for (uint32 i = 0; i < conf.basket.length; i++) {
            uint256 bal = IERC20(conf.basket.tokens[i].address).balanceOf(address(this));
            if (fullyCollateralized) {
                parts[i] = conf.basket.tokens[i].quantity * amount / 10**decimals();
            } else {
                parts[i] = bal * amount / _totalSupply;
            }
        }

        return parts;
    }

    /// =========================== Internal =================================

    /// Holds all the update actions in one place
    function _update() internal override {
        conf.basket.update(); 
        _expandSupply();
        _rebalance();
    }

    /// Expands the supply and gives the new mintings to the protocol fund and the insurance pool
    function _expandSupply() internal override {
        // 31536000 = seconds in a year
        uint256 toExpand = _totalSupply * conf.supplyExpansionRate * (block.timestamp - lastTimestamp) / 31536000 / conf.SCALE;
        lastTimestamp = block.timestamp;

        // Mint to protocol fund
        if (conf.expenditureFactor > 0) {
            uint256 e = toExpand * min(conf.SCALE, expenditureFactor) / conf.SCALE;
            _mint(conf.protocolFundAddress, e);
        }

        // Mint to self
        if (conf.expenditureFactor < conf.SCALE) {
            uint256 p = toExpand * (conf.SCALE - conf.expenditureFactor) / conf.SCALE;
            _mint(address(this), p);
        }

        // Batch transfers from self to InsurancePool
        if (balanceOf(address(this)) > _totalSupply * conf.revenueBatchSizeScaled / conf.SCALE) {
            _approve(conf.insurancePoolAddress, balanceOf(address(this)));
            IInsurancePool(conf.insurancePoolAddress).notifyRevenue(balanceOf(address(this)));
        }
    }

    /// Trades tokens against the AuctionPairs based on per-block limits
    function _rebalance() internal override {
        int32 indexLowest = leastCollateralized();
        int32 indexHighest = mostCollateralized();

        if (indexLowest >= 0 && indexHighest >= 0) {
            Basket.CollateralToken storage ctLow = conf.basket.tokens[indexLowest];
            Basket.CollateralToken storage ctHigh = conf.basket.tokens[indexHighest];
            uint256 sellAmount = min((block.number - lastBlock) * ctHigh.sellRatePerBlock, IERC20(ctHigh.address).balanceOf(address(this)) - _totalSupply * ctHigh.quantity / 10**(decimals()));
            auctionManager.trade(ctHigh.address, ctLow.address, sellAmount);
        } else if (indexLowest >= 0) {
            Basket.CollateralToken storage ctLow = conf.basket.tokens[indexLowest];
            uint256 sellAmount = (block.number - lastBlock) * conf.rsrSellRate;
            uint256 seized = insurancePool.seizeRSR(sellAmount);
            IERC20(conf.rsrTokenAddress).safeApprove(address(auctionManager), seized);
            auctionManager.trade(conf.rsrTokenAddress, ctLow.address, seized);
        } else if (indexHighest >= 0) {
            Basket.CollateralToken storage ctHigh = conf.basket.tokens[indexHighest];
            uint256 sellAmount = min((block.number - lastBlock) * ctHigh.sellRatePerBlock, IERC20(ctHigh.address).balanceOf(address(this)) - _totalSupply * ctHigh.quantity / 10**(decimals()));
            IERC20(ctHigh.address).safeApprove(address(auctionManager), sellAmount);
            auctionManager.trade(ctHigh.address, conf.rsrTokenAddress, sellAmount);
        }

        lastBlock = block.number;
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
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        if (
            from != address(0) && 
            to != address(0) && 
            address(conf.txFeeAddress) != address(0)
        ) {
            fee = ITXFee(conf.txFeeAddress).calculateFee(sender, recipient, amount);
            fee = min(fee, amount * MAX_FEE / conf.SCALE);

            _balances[from] = _balances[from] - fee;
            _balances[conf.feeRecipient] += fee;
            emit Transfer(from, feeRecipient, fee);
        }
    }

    function _recapitalizationAuctionWithCollateral(
        Settings.CollateralToken storage selling,
        Settings.CollateralToken storage buying
    ) internal override {
        uint256 bal = IERC20(selling.address).balanceOf(address(this));
        uint256 excess = bal - _totalSupply * collateral.quantity / 10**decimals();

        if (excess > selling.auctionLimits.lower) {
            // TODO: Issue an AuctionToken and handle exchange at end of auction
            auctionManager.launchAuction(selling.address, buying.address, excess);
        }
    }

    function _recapitalizationAuctionWithoutCollateral(
        Settings.CollateralToken storage buying
    ) internal override {
        auctionManager.launchAuction(
            conf.rsrTokenAddress, 
            buying.address, 
            conf.rsrAuctionLimits.upper
        );
    }

    function _profitAuction(Settings.CollateralToken storage selling) internal override {
        uint256 bal = IERC20(selling.address).balanceOf(address(this));
        uint256 excess = bal - _totalSupply * selling.quantity / 10**decimals();

        if (excess > selling.auctionLimits.lower) {
            auctionManager.launchAuction(
                address(selling), 
                conf.rsrTokenAddress,
                excess            
            );   
        }
    }
}
