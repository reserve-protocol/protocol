pragma solidity 0.8.4;

import "../zeppelin/token/ERC20/ERC20.sol";
import "../zeppelin/token/ERC20/utils/SafeERC20.sol";
import "../zeppelin/math/SafeMath.sol";
import "../zeppelin/access/AccessControlEnumerable.sol";
import "../interfaces/ITXFee.sol";
import "../interfaces/IAuctionManager.sol";
import "../interfaces/IInsurancePool.sol";
import "./Settings.sol";


/**
 * @title RToken
 * @dev An ERC-20 token with built-in rules for expanding and contracting supply.
 * 
 * Based on OpenZeppelin's [implementation](https://github.com/OpenZeppelin/openzeppelin-solidity/blob/41aa39afbc13f0585634061701c883fe512a5469/contracts/token/ERC20/ERC20.sol).
 */
contract RToken is ERC20, Base {
    using SafeERC20 for IERC20;

    IAuctionManager public immutable override auctionManager;

    /// Max Fee on transfers, ever
    uint256 public constant override MAX_FEE = 5e16; // 5%

    /// ==== Mutable State ====

    /// Timestamps
    uint256 private override lastAuction;
    uint256 private override lastSupplyExpansion;

    /// Global settlement state
    bool public override dead = false;

    constructor(
        string calldata _name, 
        string calldata _symbol, 
        Base.CollateralToken[] calldata _basket, 
        Base.Parameters calldata _parameters
    ) ERC20(_name, _symbol) Base(_basket, _parameters) public {
        auctionManager = new AuctionManager();
    }

    modifier expandSupply() {
        // 31536000 = seconds in a year
        uint256 toExpand = _totalSupply * parameters.supplyExpansionRate * (block.timestamp - lastSupplyExpansion) / 31536000 / 10**decimals();
        lastSupplyExpansion = block.timestamp;

        // Expenditure outflow
        if (parameters.expenditureFactor > 0) {
            uint256 e = toExpand * min(SCALE, expenditureFactor) / SCALE;
            _mint(parameters.outgoingExpendituresAddress, e);
        }

        // Profit outflow, batched
        if (parameters.expenditureFactor < SCALE) {
            uint256 p = toExpand * (SCALE - parameters.expenditureFactor) / SCALE;
            _mint(address(this), p);

            // Batch transfers in order to save on gas.
            uint256 bal = balanceOf(address(this));
            if (bal > _totalSupply * revenueBatchSize / 10**decimals()) {
                _transfer(address(this), parameters.rsrStakingAddress, bal)
                IInsurancePool(parameters.rsrStakingAddress).saveRevenueEvent(bal);
            }
        }

        _;
    }

    modifier circuitBreakerUnpaused() {
        bool tripped = ICircuitBreaker(parameters.circuitBreakerAddress).check();
        require(!tripped, "circuit breaker tripped");
        _;
    }
    
    modifier alive() {
        require(!dead, "global settlement has occurred, please redeem");
        _;
    }

    /// =========================== External =================================


    /// Adaptation function
    function launchAuction() external override alive expandSupply {
        require(lastAuction + parameters.auctionSpacing > block.timestamp, "too soon");
        lastAuction = block.timestamp;

        int32 indexLowest = leastCollateralized();
        int32 indexHighest = mostCollateralized();

        if (indexLowest >= 0 && indexHighest >= 0) {
            _recapitalizationAuctionWithCollateral(
                basket[indexHighest]
                basket[indexLowest], 
            );
        } else if (indexLowest >= 0) {
            _recapitalizationAuctionWithoutCollateral(basket[indexLowest]);
        } else if (indexHighest >= 0) {
            _profitAuction(basket[indexHighest]);
        } else {
            require(false, "nothing to do");
        }
    }

    /// Handles issuance.
    function issue(uint256 amount) external override alive expandSupply circuitBreakerUnpaused {
        require(amount > 0, "cannot issue zero RToken");
        require(amount < parameters.maxSupply, "at max supply");
        require(basket.length > 0, "basket cannot be empty");

        uint256[] memory amounts = issueAmounts(amount);
        for (uint32 i = 0; i < basket.length; i++) {
            IERC20(basket[i].address).safeTransferFrom(
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
        require(basket.length > 0, "basket cannot be empty");

        _burnFrom(_msgSender(), amount);

        uint256[] memory amounts = redemptionAmounts(amount);
        for (uint32 i = 0; i < basket.length; i++) {
            IERC20(basket[i].address).safeTransferFrom(
                address(this),
                _msgSender(),
                amounts[i]
            );
        }

        emit Redemption(_msgSender(), amount);
    }

    /// Global Settlement
    function kill() external override alive expandSupply {
        IERC20(parameters.rsrTokenAddress).safeTransferFrom(
            _msgSender(),
            address(0),
            parameters.globalSettlementCost
        );
        dead = true;
        emit Killed(_msgSender())
    }
    

    /// =========================== Views =================================

    /// Returns index of least collateralized token, or -1 if fully collateralized.
    function leastCollateralized() public view returns (int32) {
        uint256 largestDeficit;
        int32 index = -1;

        for (uint32 i = 0; i < basket.length; i++) {
            uint256 bal = IERC20(basket[i].address).balanceOf(address(this));
            uint256 expected = _totalSupply * basket[i].quantity / 10**decimals();

            if (bal < expected) {
                uint256 deficit = (expected - bal) / basket[i].quantity;
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

        for (uint32 i = 0; i < basket.length; i++) {
            uint256 bal = IERC20(basket[i].address).balanceOf(address(this));
            uint256 expected = _totalSupply * basket[i].quantity / 10**decimals();
            expected += basket[i].auctionLimits.lower;

            if (bal > expected) {
                uint256 surplus = (bal - expected) / basket[i].quantity;
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
        uint256[] memory parts = new uint256[](basket.length);

        for (uint32 i = 0; i < basket.length; i++) {
            parts[i] = amount * basket[i].quantity / 10**decimals();
            parts[i] = parts[i] * (SCALE + parameters.spread) / SCALE;
        }

        return parts;
    }


    /// The returned array will be in the same order as the current basket.
    function redemptionAmounts(uint256 amount) public view returns (uint256[] memory) {
        uint256[] memory parts = new uint256[](basket.length);

        bool fullyCollateralized = fullyCollateralized();
        for (uint32 i = 0; i < basket.length; i++) {
            uint256 bal = IERC20(basket[i].address).balanceOf(address(this));
            if (fullyCollateralized) {
                parts[i] = basket[i].quantity * amount / 10**decimals();
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
     * Implements an optional tx fee on transfers, up to a constant `MAX_FEE` percentage.
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        if (
            from != address(0) && 
            to != address(0) && 
            address(parameters.txFeeAddress) != address(0)
        ) {
            fee = ITXFee(parameters.txFeeAddress).calculateFee(sender, recipient, amount);
            require(fee <= amount * MAX_FEE / SCALE, "transaction fee above maximum allowed");

            _balances[from] = _balances[from] - fee;
            _balances[settings.feeRecipient] += fee;
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
            parameters.rsrTokenAddress, 
            buying.address, 
            settings.rsrAuctionLimits.upper
        );
    }

    function _profitAuction(Settings.CollateralToken storage selling) internal override {
        uint256 bal = IERC20(selling.address).balanceOf(address(this));
        uint256 excess = bal - _totalSupply * selling.quantity / 10**decimals();

        if (excess > selling.auctionLimits.lower) {
            auctionManager.launchAuction(
                address(selling), 
                parameters.rsrTokenAddress,
                excess            
            );   
        }
    }
}
