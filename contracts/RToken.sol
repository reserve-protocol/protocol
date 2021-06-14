pragma solidity 0.8.4;

import "../zeppelin/token/ERC20/utils/SafeERC20.sol";
import "../zeppelin/token/IERC20.sol";
import "../zeppelin/access/Ownable.sol";
import "../interfaces/IConfiguration.sol";
import "../interfaces/ITXFee.sol";
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
contract RToken is SlowMintingERC20, Ownable {
    using SafeERC20 for IERC20;

    /// ==== Immutable State ====

    IAuctionManager public immutable override auctionManager;
    IConfiguration public immutable override conf;

    /// Max Fee on transfers, ever
    uint256 public constant override MAX_FEE = 5e16; // 5%

    /// ==== Mutable State ====

    /// Timestamps
    uint256 private override lastAuction;
    uint256 private override lastSupplyExpansion;

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

    /// Called at the start of every external
    modifier expandSupply() {
        // Expands the supply to 2 parties based on how much time has passed. 
        if (!dead) {
            // 31536000 = seconds in a year
            uint256 toExpand = _totalSupply * conf.params.supplyExpansionRate * (block.timestamp - lastSupplyExpansion) / 31536000 / 10**decimals();
            lastSupplyExpansion = block.timestamp;

            // Expenditure outflow
            if (conf.params.expenditureFactor > 0) {
                uint256 e = toExpand * min(conf.SCALE, expenditureFactor) / conf.SCALE;
                _mint(conf.params.outgoingExpendituresAddress, e);
            }

            // Profit outflow, batched
            if (conf.params.expenditureFactor < conf.SCALE) {
                uint256 p = toExpand * (conf.SCALE - conf.params.expenditureFactor) / conf.SCALE;
                _mint(address(this), p);

                // Batch transfers in order to save on gas.
                uint256 bal = balanceOf(address(this));
                if (bal > _totalSupply * revenueBatchSize / 10**decimals()) {
                    _transfer(address(this), conf.params.insurancePoolAddress, bal)
                    IInsurancePool(conf.params.insurancePoolAddress).saveRevenueEvent(bal);
                }
            }
        }

        _;
    }

    modifier circuitBreakerUnpaused() {
        bool tripped = ICircuitBreaker(conf.params.circuitBreakerAddress).check();
        require(!tripped, "circuit breaker tripped");
        _;
    }
    
    modifier alive() {
        require(!dead, "global settlement has occurred, please redeem");
        _;
    }

    /// =========================== External =================================


    /// Configuration changes, only callable by Owner.
    function changeConfiguration(address newConf) external override alive expandSupply onlyOwner {
        conf = IConfiguration(newConf);
    }

    /// Adaptation function, callable by anyone
    function launchAuction() external override alive expandSupply {
        require(lastAuction + conf.params.auctionSpacing > block.timestamp, "too soon");
        lastAuction = block.timestamp;

        int32 indexLowest = leastCollateralized();
        int32 indexHighest = mostCollateralized();

        if (indexLowest >= 0 && indexHighest >= 0) {
            _recapitalizationAuctionWithCollateral(
                conf.basket[indexHighest]
                conf.basket[indexLowest], 
            );
        } else if (indexLowest >= 0) {
            _recapitalizationAuctionWithoutCollateral(conf.basket[indexLowest]);
        } else if (indexHighest >= 0) {
            _profitAuction(conf.basket[indexHighest]);
        } else {
            require(false, "nothing to do");
        }
    }

    /// Handles issuance.
    /// Requires approvals to be in place beforehand.
    function issue(uint256 amount) external override alive expandSupply circuitBreakerUnpaused {
        require(amount > 0, "cannot issue zero RToken");
        require(amount < conf.params.maxSupply, "at max supply");
        require(conf.basket.length > 0, "basket cannot be empty");

        uint256[] memory amounts = issueAmounts(amount);
        for (uint32 i = 0; i < conf.basket.length; i++) {
            IERC20(conf.basket[i].address).safeTransferFrom(
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
            IERC20(conf.basket[i].address).safeTransfer(
                _msgSender(),
                amounts[i]
            );
        }

        emit Redemption(_msgSender(), amount);
    }

    /// Global Settlement
    function kill() external override alive expandSupply {
        IERC20(conf.params.rsrTokenAddress).safeTransferFrom(
            _msgSender(),
            address(0),
            conf.params.globalSettlementCost
        );
        dead = true;
        emit Killed(_msgSender());
    }

    /// =========================== Views =================================

    /// Returns index of least collateralized token, or -1 if fully collateralized.
    function leastCollateralized() public view returns (int32) {
        uint256 largestDeficit;
        int32 index = -1;

        for (uint32 i = 0; i < conf.basket.length; i++) {
            uint256 bal = IERC20(conf.basket[i].address).balanceOf(address(this));
            uint256 expected = _totalSupply * conf.basket[i].quantity / 10**decimals();

            if (bal < expected) {
                uint256 deficit = (expected - bal) / conf.basket[i].quantity;
                if (deficit > largestDeficit) {
                    largestDeficit = deficit;
                    index = i;
                }
            }
        }
        return index;
    }

    /// Returns the index of the most collateralized token, or -1.
    function mostCollateralized() public view returns (int32) {
        uint256 largestSurplus;
        int32 index = -1;

        for (uint32 i = 0; i < conf.basket.length; i++) {
            uint256 bal = IERC20(conf.basket[i].address).balanceOf(address(this));
            uint256 expected = _totalSupply * conf.basket[i].quantity / 10**decimals();
            expected += conf.basket[i].auctionLimits.lower;

            if (bal > expected) {
                uint256 surplus = (bal - expected) / conf.basket[i].quantity;
                if (surplus > largestSurplus) {
                    largestSurplus = surplus;
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
            parts[i] = amount * conf.basket[i].quantity / 10**decimals();
            parts[i] = parts[i] * (conf.SCALE + conf.params.spread) / conf.SCALE;
        }

        return parts;
    }


    /// The returned array will be in the same order as the current basket.
    function redemptionAmounts(uint256 amount) public view returns (uint256[] memory) {
        uint256[] memory parts = new uint256[](conf.basket.length);

        bool fullyCollateralized = fullyCollateralized();
        for (uint32 i = 0; i < conf.basket.length; i++) {
            uint256 bal = IERC20(conf.basket[i].address).balanceOf(address(this));
            if (fullyCollateralized) {
                parts[i] = conf.basket[i].quantity * amount / 10**decimals();
            } else {
                parts[i] = bal * amount / _totalSupply;
            }
        }

        return parts;
    }

    /// =========================== Internal =================================

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
            address(conf.params.txFeeAddress) != address(0)
        ) {
            fee = ITXFee(conf.params.txFeeAddress).calculateFee(sender, recipient, amount);
            fee = min(fee, amount * MAX_FEE / conf.SCALE);

            _balances[from] = _balances[from] - fee;
            _balances[conf.params.feeRecipient] += fee;
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
            conf.params.rsrTokenAddress, 
            buying.address, 
            conf.params.rsrAuctionLimits.upper
        );
    }

    function _profitAuction(Settings.CollateralToken storage selling) internal override {
        uint256 bal = IERC20(selling.address).balanceOf(address(this));
        uint256 excess = bal - _totalSupply * selling.quantity / 10**decimals();

        if (excess > selling.auctionLimits.lower) {
            auctionManager.launchAuction(
                address(selling), 
                conf.params.rsrTokenAddress,
                excess            
            );   
        }
    }
}
