pragma solidity 0.8.4;

import "../zeppelin/token/ERC20/ERC20.sol";
import "../zeppelin/token/ERC20/utils/SafeERC20.sol";
import "../zeppelin/math/SafeMath.sol";
import "../zeppelin/access/AccessControlEnumerable.sol";
import "../interfaces/ITXFee.sol";
import "../interfaces/IAuctionManager.sol";
import "../interfaces/IRSRStaking.sol";
import "./Settings.sol";


/**
 * @title RToken
 * @dev An ERC-20 token with built-in rules for expanding and contracting supply.
 * 
 * Based on OpenZeppelin's [implementation](https://github.com/OpenZeppelin/openzeppelin-solidity/blob/41aa39afbc13f0585634061701c883fe512a5469/contracts/token/ERC20/ERC20.sol).
 */
contract RToken is ERC20 {
    using SafeERC20 for IERC20;

    Settings public immutable override settings;
    IAuctionManager public immutable override auctionManager;

    /// Max Fee on transfers
    uint256 constant MAX_FEE = 5e16; // 5%
    uint256 constant SCALE = 1e18;


    /// ==== Mutable State ====

    /// Timestamps
    uint256 private override lastAuction;
    uint256 private override lastSupplyExpansion;

    /// Global settlement state
    bool public override dead = false;

    /// Expects Settings to be deployed already.
    constructor(
        string calldata _name, 
        string calldata _symbol, 
        Settings calldata _settings
    ) ERC20(_name, _symbol) public {
        settings = _settings;
        auctionManager = new AuctionManager();
    }

    modifier expandSupply() {
        // 31536000 = seconds in a year
        uint256 toExpand = _totalSupply * settings.parameters.supplyExpansionRate * (block.timestamp - lastSupplyExpansion) / 31536000 / SCALE;
        lastSupplyExpansion = block.timestamp;

        // Expenditure outflow
        if (settings.parameters.expenditureFactor > 0) {
            uint256 e = toExpand * min(SCALE, expenditureFactor) / SCALE;
            _mint(settings.parameters.outgoingExpendituresAddress, e);
        }

        // Profit outflow, batched
        if (settings.parameters.expenditureFactor < SCALE) {
            uint256 p = toExpand * (SCALE - settings.parameters.expenditureFactor) / SCALE;
            _mint(address(this), p);

            // Batch transfers in order to save on gas.
            uint256 bal = balanceOf(address(this));
            if (bal > _totalSupply * revenueBatchSize / SCALE) {
                _transfer(address(this), settings.parameters.rsrStakingAddress, bal)
                IRSRStaking(settings.parameters.rsrStakingAddress).saveRevenueEvent(bal);
            }
        }

        _;
    }

    modifier circuitBreakerUnpaused() {
        bool tripped = ICircuitBreaker(settings.parameters.circuitBreakerAddress).check();
        require(!tripped, "circuit breaker tripped");
        _;
    }
    
    modifier alive() {
        require(dead, "global settlement has occurred, please redeem");
        _;
    }

    /// =========================== External =================================


    /// Adaptation function
    function act() external override alive expandSupply {
        require(lastAuction + settings.parameters.auctionSpacing > block.timestamp, "too soon");
        lastAuction = block.timestamp;

        int32 indexLowest = leastCollateralized();
        int32 indexHighest = mostCollateralized();

        if (indexLowest >= 0 && indexHighest >= 0) {
            _recapitalizationAuctionWithCollateral(
                settings.basket[indexHighest]
                settings.basket[indexLowest], 
            );
        } else if (indexLowest >= 0) {
            _recapitalizationAuctionWithoutCollateral(settings.basket[indexLowest]);
        } else if (indexHighest >= 0) {
            _profitAuction(settings.basket[indexHighest]);
        } else {
            require(false, "nothing to do");
        }
    }

    /// Handles issuance.
    function issue(uint256 amount) external override alive expandSupply circuitBreakerUnpaused {
        require(amount > 0, "cannot issue zero RToken");
        require(amount < settings.parameters.maxSupply, "at max supply");
        require(settings.basket.length > 0, "basket cannot be empty");

        uint256[] memory amounts = issueAmounts(amount);
        for (uint32 i = 0; i < settings.basket.length; i++) {
            IERC20(settings.basket[i].address).safeTransferFrom(
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
        require(settings.basket.length > 0, "basket cannot be empty");

        _burnFrom(_msgSender(), amount);

        uint256[] memory amounts = redemptionAmounts(amount);
        for (uint32 i = 0; i < settings.basket.length; i++) {
            IERC20(settings.basket[i].address).safeTransferFrom(
                address(this),
                _msgSender(),
                amounts[i]
            );
        }

        emit Redemption(_msgSender(), amount);
    }

    /// Global Settlement
    function kill() external override alive expandSupply {
        IERC20(settings.parameters.rsrTokenAddress).safeTransferFrom(
            _msgSender(),
            address(0),
            settings.parameters.globalSettlement
        );
        dead = true;
        emit Killed(_msgSender())
    }
    

    /// =========================== Views =================================

    /// Returns index of least collateralized token, or -1 if fully collateralized.
    function leastCollateralized() public view returns (int32) {
        uint256 largestDeficit;
        int32 index = -1;

        for (uint32 i = 0; i < settings.basket.length; i++) {
            uint256 bal = IERC20(settings.basket[i].address).balanceOf(address(this));
            uint256 expected = _totalSupply * settings.basket[i].quantity / SCALE;

            if (bal < expected) {
                uint256 deficit = (expected - bal) / settings.basket[i].quantity;
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

        for (uint32 i = 0; i < settings.basket.length; i++) {
            uint256 bal = IERC20(settings.basket[i].address).balanceOf(address(this));
            uint256 expected = _totalSupply * settings.basket[i].quantity / SCALE;
            expected += settings.basket[i].auctionLimits.lower;

            if (bal > expected) {
                uint256 surplus = (bal - expected) / settings.basket[i].quantity;
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
        uint256[] memory parts = new uint256[](settings.basket.length);

        for (uint32 i = 0; i < settings.basket.length; i++) {
            parts[i] = amount * settings.basket[i].quantity / SCALE;
            parts[i] = parts[i] * (SCALE + settings.parameters.spread) / SCALE;
        }

        return parts;
    }


    /// The returned array will be in the same order as the current basket.
    function redemptionAmounts(uint256 amount) public view returns (uint256[] memory) {
        uint256[] memory parts = new uint256[](settings.basket.length);

        bool fullyCollateralized = fullyCollateralized();
        for (uint32 i = 0; i < settings.basket.length; i++) {
            uint256 bal = IERC20(settings.basket[i].address).balanceOf(address(this));
            if (fullyCollateralized) {
                parts[i] = settings.basket[i].quantity * amount / SCALE;
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
            address(settings.parameters.txFeeAddress) != address(0)
        ) {
            fee = ITXFee(settings.parameters.txFeeAddress).calculateFee(sender, recipient, amount);
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
        uint256 excess = bal - _totalSupply * collateral.quantity / SCALE;

        if (excess > selling.auctionLimits.lower) {
            // TODO: Issue an AuctionToken and handle exchange at end of auction
            auctionManager.launchAuction(selling.address, buying.address, excess);
        }
    }

    function _recapitalizationAuctionWithoutCollateral(
        Settings.CollateralToken storage buying
    ) internal override {
        auctionManager.launchAuction(
            settings.parameters.rsrTokenAddress, 
            buying.address, 
            settings.rsrAuctionLimits.upper
        );
    }

    function _profitAuction(Settings.CollateralToken storage selling) internal override {
        uint256 bal = IERC20(selling.address).balanceOf(address(this));
        uint256 excess = bal - _totalSupply * selling.quantity / SCALE;

        if (excess > selling.auctionLimits.lower) {
            auctionManager.launchAuction(
                address(selling), 
                settings.parameters.rsrTokenAddress,
                excess            
            );   
        }
    }
}
