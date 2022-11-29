// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IWrappedfCash.sol";
import "./IWrappedfCashFactory.sol";
import "./INotionalProxy.sol";
import "contracts/libraries/Fixed.sol";
import "hardhat/console.sol";


contract ReserveWrappedFCash is ERC20 {
    using SafeERC20 for IERC20Metadata;

    INotionalProxy private immutable notionalProxy;
    IWrappedfCashFactory private immutable wfCashFactory;
    IERC20Metadata private immutable underlyingAsset;
    uint16 private immutable currencyId;

    struct Market {
        uint256 maturity;
        uint8 monthsTenor;
    }

    Market private globalMarket;

    mapping(address => Market) private market;
    mapping(address => uint256) private deposited;
    mapping(address => uint256) private previousRate;

    constructor(
        address _notionalProxy,
        address _wfCashFactory,
        IERC20Metadata _underlyingAsset,
        uint16 _currencyId
    ) ERC20("Reserve Wrapped fCash", "rwfCash") {
        notionalProxy = INotionalProxy(_notionalProxy);
        wfCashFactory = IWrappedfCashFactory(_wfCashFactory);
        underlyingAsset = _underlyingAsset;
        currencyId = _currencyId;
    }

    /// @notice This function will return the ratio of appreciation of the deposited assets
    ///   of the calling account.
    /// @return rate The ratio of value of a deposited token to what it's currently worth
    /// @dev This rate might decrease when re-investing because of the fee to enter a market
    function refPerTok() public view returns (uint256 rate) {
        uint256 depositedAmount = deposited[_msgSender()];

        if (depositedAmount != 0) {
            uint256 maturity = market[_msgSender()].maturity;
            IWrappedfCash wfCash = getWfCash(maturity);
            int256 underlyingValue;

            if (wfCash.hasMatured()) {
                underlyingValue = int256(balanceOf(_msgSender()));
            }
            else {
                underlyingValue = notionalProxy.getPresentfCashValue(
                    currencyId, maturity, int88(int256(balanceOf(_msgSender()))), block.timestamp, false
                );
            }

            // given the amount of deposited tokens, compute the value of a single one
            rate = uint256(underlyingValue) * 10 ** underlyingAsset.decimals() / depositedAmount;
            rate = rate * previousRate[_msgSender()];
        }
        else {
            rate = 0;
        }
    }

    /// @notice Deposits `amount` into the most profitable market at this time
    ///   or the market where the account is already invested
    function deposit(uint256 amount) external {
        require(amount > 0, "empty deposit amount");

        if (globalMarket.maturity < block.timestamp) {
            // if globalMarket maturity is in the past
            // it has matured and it needs to update
            globalMarket = getMostProfitableMarket();
        }

        if (market[_msgSender()].maturity == 0) {
            // if maturity is zero this account has no positions open
            market[_msgSender()] = globalMarket;
            previousRate[_msgSender()] = 1;
        }

        _depositByUser(amount, market[_msgSender()].maturity);
    }

    /// @notice Deposits `amount` into the given `marketIndex`
    /// @dev to use this method the account needs to not have any prior position
    function depositTo(uint256 amount, uint8 marketIndex) external {
        require(amount > 0, "empty deposit amount");
        require(market[_msgSender()].maturity == 0, "market already selected");

        Market memory chosenMarket = getMarket(marketIndex);
        market[_msgSender()] = chosenMarket;
        previousRate[_msgSender()] = 1;

        _depositByUser(amount, chosenMarket.maturity);
    }

    function withdraw(uint256 amount) external {
        require(amount > 0, "empty withdraw amount");
        uint256 balance = balanceOf(_msgSender());
        require(balance >= amount, "not enough balance");

        Market memory currentMarket = market[_msgSender()];

        IWrappedfCash wfCash = getWfCash(currentMarket.maturity);

        // compute the total of deposited value to be discounted
        uint256 currentlyDeposited = deposited[_msgSender()];
        uint256 percentageToWithdraw = amount * 1e18 / balance;
        uint256 depositedToDiscount = currentlyDeposited * percentageToWithdraw / 1e18;

        // update deposited balance
        deposited[_msgSender()] = currentlyDeposited - depositedToDiscount;

        // burn the tokens being withdrawn
        _burn(_msgSender(), amount);

        // redeem the lend to the user
        wfCash.redeemToUnderlying(amount, _msgSender(), 0);

        if (percentageToWithdraw == 1e18) {
            delete market[_msgSender()];
            delete deposited[_msgSender()];
            delete previousRate[_msgSender()];
        }
    }

    function reinvest() external {
        Market memory currentMarket = market[_msgSender()];
        require(currentMarket.maturity > 0, "market not initialized");
        IWrappedfCash wfCash = getWfCash(currentMarket.maturity);
        require(wfCash.hasMatured(), "market has not matured yet");

        previousRate[_msgSender()] = refPerTok();

        // take everything out
        uint256 currentfCashAmount = balanceOf(_msgSender());
        _burn(_msgSender(), currentfCashAmount);
        wfCash.redeemToUnderlying(currentfCashAmount, address(this), 0);

        // get new maturity
        if (currentMarket.maturity == globalMarket.maturity) {
            Market memory bestMarket = getMostProfitableMarket();
            market[_msgSender()] = bestMarket;
            currentMarket = bestMarket;
            globalMarket = bestMarket;
        }
        else {
            market[_msgSender()] = globalMarket;
            currentMarket = globalMarket;
        }

        // get new market
        wfCash = IWrappedfCash(
            wfCashFactory.deployWrapper(currencyId, uint40(currentMarket.maturity))
        );

        // lend everything
        _deposit(currentfCashAmount, wfCash);
    }

    /** Getters **/

    function activeMarkets() external view returns (Market[] memory markets) {
        INotionalProxy.MarketParameters[] memory _activeMarkets = notionalProxy.getActiveMarkets(currencyId);
        uint256 length = _activeMarkets.length;
        require(length > 0, 'no available markets');

        markets = new Market[](length);

        for (uint i = 0; i < length; i++) {
            markets[i] = Market(_activeMarkets[i].maturity, getMonthsTenor(i));
        }
    }

    /// @notice Returns the amount of tokens deposited by `account`
    function depositedBy(address account) external view returns (uint256 amount) {
        amount = deposited[account];
    }

    function hasMatured() external view returns (bool) {
        require(market[_msgSender()].maturity > 0, "no existing position");
        IWrappedfCash wfCash = getWfCash(market[_msgSender()].maturity);
        return wfCash.hasMatured();
    }

    /** Helpers **/

    /// Deposits `amount` into a specific market maturity`
    /// @param amount The amount to deposit
    /// @param maturity The maturity of the market to enter
    function _depositByUser(uint256 amount, uint256 maturity) private {
        IWrappedfCash wfCash = IWrappedfCash(
            wfCashFactory.deployWrapper(currencyId, uint40(maturity))
        );

        // transfer assets from user
        underlyingAsset.safeTransferFrom(_msgSender(), address(this), amount);

        // approve wfCash's Notional contract
        underlyingAsset.safeApprove(address(wfCash), amount);

        _deposit(amount, wfCash);
    }

    /// Deposits `amount` into a specific market `wfCash`
    /// @param amount The amount to deposit
    /// @param wfCash The maturity of the market to enter
    function _deposit(uint256 amount, IWrappedfCash wfCash) private {
        // ask Notional how much fCash we should receive for our assets
        (uint88 fCashAmount,,) = notionalProxy.getfCashLendFromDeposit(
            currencyId, amount, wfCash.getMaturity(), 0, block.timestamp, true
        );

        // mint wfCash
        wfCash.mintViaUnderlying(amount, fCashAmount, address(this), 0);

        // mint wrapped tokens
        _mint(_msgSender(), fCashAmount);

        // update deposited amount
        deposited[_msgSender()] = amount - costOfEnteringMarket(amount, wfCash);
    }

    /// @dev Hook that is called before any transfer of tokens.
    ///
    /// It is used to transfer the `deposited` amounts when tokens
    /// are transferred to a different account.
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        if (from == address(0) || to == address(0)) return;
        require(
            market[to].maturity == 0 || market[from].maturity == market[to].maturity,
            "different maturities"
        );

        uint256 balance = balanceOf(from);

        uint256 percentageToMove = computePercentage(amount, balance);
        uint256 depositedToMove = deposited[from] * percentageToMove / 1e18;

        deposited[from] = deposited[from] - depositedToMove;
        deposited[to] = deposited[to] + depositedToMove;
    }

    /// Compute the cost of depositing `amount` into the selected market
    ///
    /// Entering a market has a 0.3% annualized fee.
    /// The fee is prorated on the days remaining for the market to mature.
    ///
    /// if we deposit on day one on a 1 year tenor market, the cost is 0.3%
    /// if we deposit on day one on a 6 months tenor market, the cost is 0.15%
    /// if we deposit after 3 months on a 6 months tenor market, the cost is 0.075%
    ///
    /// @param amount The amount to deposit
    /// @param wfCash Instance of the wfCash market contract we are interacting with
    function costOfEnteringMarket(uint256 amount, IWrappedfCash wfCash) private view returns (uint256) {
        uint32 daysUntilMaturity = getDaysUntilMaturity(wfCash);
        uint32 months = market[_msgSender()].monthsTenor;
        // compute the percentage fee to pay given the market we enter
        // multipy by 100 to avoid decimals
        uint32 marketRate = (months * 1e2) / 12;
        // compute the percentage of fee to pay given the remaining time
        // multipy by 100 to avoid decimals
        uint32 lateEntryDiscount = (daysUntilMaturity * 1e5) / (months * 30);
        // operate everything to obtain the final percentage fee to apply
        uint64 feeBasisPoints = (30 * marketRate * lateEntryDiscount);

        // operate, and then divide by 1e11:
        // 2 to compensate the marketRate op
        // 5 to compensate the lateEntryDiscount op
        // 4 to compensate the basis points units
        // delaying the division increases the precision
        return (amount * feeBasisPoints) / 1e11;
    }

    /// Compute how much percentage of `total` is `amount`
    /// @param amount Amount that we want to know
    /// @param total Amount that represents the total
    /// @return result Percentage in 18 decimals to maximize precision
    function computePercentage(uint256 amount, uint256 total) private pure returns (uint256 result) {
        result = amount * 1e18 / total;
    }

    /// Return the amount of days between now and the maturity time of the market
    function getDaysUntilMaturity(IWrappedfCash wfCash) private view returns (uint16) {
        uint40 secs = wfCash.getMaturity() - uint40(block.timestamp);

        return uint16(secs / 1 days);
    }

    /// Convert an amount from 8 decimals to the number of decimals of the underlying asset
    /// @param amount The number to be converted
    function convertToAssetDecimals(uint256 amount) private view returns (uint256) {
        int8 decimalsDiff = int8(underlyingAsset.decimals()) - 8;
        uint256 coefficient = 10 ** abs(decimalsDiff);
        if (decimalsDiff > 0) {
            return amount * coefficient;
        }
        else {
            return amount / coefficient;
        }
    }

    /// Return an instance to Notional's wfCash contract of the given maturity
    /// @dev if it's used a maturity that is not deployed yet, a deploy will happen
    function getWfCash(uint256 maturity) internal view returns (IWrappedfCash wfCash){
        // has internal cache so will only deploy if still not deployed
        wfCash = IWrappedfCash(
            wfCashFactory.computeAddress(currencyId, uint40(maturity))
        );
        return wfCash;
    }

    /// Fetch all markets and returns the most profitable one
    /// @return selectedMarket The market with the best rate at the moment
    function getMostProfitableMarket() private view returns (Market memory selectedMarket) {
        INotionalProxy.MarketParameters[] memory markets = notionalProxy.getActiveMarkets(currencyId);
        uint256 length = markets.length;
        require(length > 0, 'no available markets');

        uint256 biggestRate;

        for (uint i = 0; i < length; i++) {
            if (markets[i].oracleRate > biggestRate) {
                biggestRate = markets[i].oracleRate;
                selectedMarket.maturity = markets[i].maturity;
                selectedMarket.monthsTenor = getMonthsTenor(i);
            }
        }
    }

    /// Fetch all markets and returns the one on the selected index
    /// @return selectedMarket The market with the selected index
    function getMarket(uint8 index) private view returns (Market memory selectedMarket) {
        INotionalProxy.MarketParameters[] memory availableMarkets = notionalProxy.getActiveMarkets(currencyId);
        uint256 length = availableMarkets.length;
        require(length > 0, 'no available markets');
        require(index < length, 'market not available');

        selectedMarket.maturity = availableMarkets[index].maturity;
        selectedMarket.monthsTenor = getMonthsTenor(index);
    }

    /// @param index The market index to be checked
    /// @return months Number of months of this tenor
    /// @dev markets always come ordered and are enabled from short to long
    function getMonthsTenor(uint256 index) private pure returns (uint8 months) {
        if (index == 0) {
            // 3 months
            months = 3;
        }
        else if (index == 1) {
            // 6 months
            months = 6;
        }
        else if (index == 2) {
            // 1 year
            months = 12;
        }
        else if (index == 3) {
            // 2 years
            months = 24;
        }
        else if (index == 4) {
            // 5 years
            months = 60;
        }
        else if (index == 5) {
            // 10 years
            months = 120;
        }
        else if (index == 6) {
            // 20 years
            months = 240;
        }
        else {
            revert("market index too high");
        }
    }

    /// @notice Using 8 decimals as the rest of Notional tokens
    function decimals() public pure override returns (uint8) {
        return 8;
    }
}
