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

    mapping(address => uint256) private maturity;
    mapping(address => uint256) private deposited;
    mapping(address => uint8) private monthsTenor;

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
    function refPerTok() external view returns (uint256 rate) {
        uint256 depositedAmount = deposited[_msgSender()];

        if (depositedAmount != 0) {
            int256 underlyingValue = notionalProxy.getPresentfCashValue(
                currencyId, maturity[_msgSender()], int88(int256(balanceOf(_msgSender()))), block.timestamp, false
            );

            // given the amount of deposited tokens, compute the value of a single one
            rate = uint256(underlyingValue) * 10 ** underlyingAsset.decimals() / depositedAmount;
        }
        else {
            rate = 0;
        }
    }

    function deposit(uint256 amount) external {
        require(amount > 0, "empty deposit amount");

        IWrappedfCash wfCash = getCurrentWfCash();

        // ask Notional how much fCash we should receive for our assets
        (uint88 fCashAmount,,) = notionalProxy.getfCashLendFromDeposit(
            currencyId, amount, getMaturity(), 0, block.timestamp, true
        );

        // transfer assets from user
        underlyingAsset.safeTransferFrom(_msgSender(), address(this), amount);

        // approve wfCash's Notional contract
        underlyingAsset.safeApprove(address(wfCash), amount);

        // mint wfCash
        wfCash.mintViaUnderlying(amount, fCashAmount, address(this), 0);

        // mint wrapped tokens
        _mint(_msgSender(), fCashAmount);

        // update deposited amount
        deposited[_msgSender()] = amount - costOfEnteringMarket(amount, wfCash);
    }

    function withdraw(uint256 amount) external {
        require(amount > 0, "empty withdraw amount");
        uint256 balance = balanceOf(_msgSender());
        require(balance >= amount, "not enough balance");

        IWrappedfCash wfCash = getCurrentWfCash();

        // compute the total of deposited value to be discounted
        uint256 currentlyDeposited = deposited[_msgSender()];
        uint256 percentageToWithdraw = computePercentage(amount, balance);
        uint256 depositedToDiscount = currentlyDeposited * percentageToWithdraw / 1e18;

        // update deposited balance
        deposited[_msgSender()] = currentlyDeposited - depositedToDiscount;

        // burn the tokens being withdrawn
        _burn(_msgSender(), amount);

        // redeem the lend to the user
        wfCash.redeemToUnderlying(amount, _msgSender(), 0);
    }

    /// @notice Returns the amount of tokens deposited by `account`
    function depositedBy(address account) external view returns (uint256 amount) {
        amount = deposited[account];
    }

    /** Internal helpers **/

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

        uint256 balance = balanceOf(from);

        uint256 percentageToMove = computePercentage(amount, balance);
        uint256 depositedToMove = deposited[from] * percentageToMove / 1e18;

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
        uint32 months = monthsTenor[_msgSender()];
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

    /// Return an instance to Notional's wfCash contract of the current user's maturity
    /// @dev if a user happens to use a maturity that is not deployed yet, a deploy will happen
    function getCurrentWfCash() internal returns (IWrappedfCash wfCash){
        // has internal cache so will only deploy if still not deployed
        wfCash = IWrappedfCash(
            wfCashFactory.deployWrapper(currencyId, uint40(getMaturity()))
        );
        return wfCash;
    }

    /// Return the current maturity of the user interacting with the contract
    /// if there's none yet, it fetches the most profitable
    function getMaturity() private returns (uint256) {
        if (maturity[_msgSender()] == 0) {
            (uint256 bestMaturity, uint8 months) = getMostProfitableMarket();
            maturity[_msgSender()] = bestMaturity;
            monthsTenor[_msgSender()] = months;
        }

        return maturity[_msgSender()];
    }

    /// Fetch all markets and returns the most profitable one
    /// @return bestMaturity The maturity of the selected market
    /// @return months The number of months that the market lasts (tenor)
    function getMostProfitableMarket() private view returns (uint256 bestMaturity, uint8 months) {
        INotionalProxy.MarketParameters[] memory markets = notionalProxy.getActiveMarkets(currencyId);
        uint256 length = markets.length;
        require(length > 0, 'no available markets');

        uint256 biggestRate;

        for (uint i = 0; i < length; i++) {
            if (markets[i].oracleRate > biggestRate) {
                biggestRate = markets[i].oracleRate;
                bestMaturity = markets[i].maturity;
                months = getMonthsTenor(i);
            }
        }
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
