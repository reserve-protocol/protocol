// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "contracts/libraries/Fixed.sol";
import "./IWrappedfCash.sol";
import "./IWrappedfCashFactory.sol";
import "./INotionalProxy.sol";
import "./IReservefCashWrapper.sol";


contract ReservefCashWrapper is ERC20, IReservefCashWrapper {
    using SafeERC20 for IERC20Metadata;

    INotionalProxy private immutable notionalProxy;
    IWrappedfCashFactory private immutable wfCashFactory;
    IERC20Metadata private immutable underlyingAsset;
    uint16 private immutable currencyId;

    struct Market {
        // timestamp of when the market matures
        uint256 maturity;
        // tenor of the market in months
        uint8 monthsTenor;
        // expected APY
        uint256 rate;
    }

    struct Position {
        // amount of fCash owned on Notional from this position
        uint256 fCash;
        // amount of wrapped tokens that represent the position
        uint256 balance;
    }

    // stores the positions of the wrapper
    // maturity => position
    mapping(uint256 => Position) private positions;
    // stores if a market has any position
    // maturity => active
    mapping(uint256 => bool) private enabledMarkets;
    // list of the maturities where the wrapper has positions
    uint256[] private markets;

    // stores the last refPerTok before withdrawing all funds
    uint256 private lastRefPerTok;

    constructor(
        address _notionalProxy,
        address _wfCashFactory,
        IERC20Metadata _underlyingAsset,
        uint16 _currencyId
    ) ERC20(
        string(abi.encodePacked("Reserve Wrapped fCash (Vault ", _underlyingAsset.name(), ")")),
        string(abi.encodePacked("rwfCash:", Strings.toString(_currencyId)))
    ) {
        require(_notionalProxy != address(0), "missing notional proxy address");
        require(_wfCashFactory != address(0), "missing wfCashFactory address");
        require(address(_underlyingAsset) != address(0), "missing underlying asset address");
        require(_currencyId > 0, "invalid currencyId");

        notionalProxy = INotionalProxy(_notionalProxy);
        wfCashFactory = IWrappedfCashFactory(_wfCashFactory);
        underlyingAsset = _underlyingAsset;
        currencyId = _currencyId;
        lastRefPerTok = 1e18;
    }

    /// @notice Returns the ratio of appreciation of the deposited assets
    /// @return rate The ratio of value of a deposited token to what it's currently worth
    function refPerTok() public view returns (uint256 rate) {
        uint256 length = markets.length;

        if (length == 0) {
            // if there's no positions open we return the last known value
            rate = lastRefPerTok;
        }
        else {
            // otherwise we compute the current rate
            uint256 maturity;
            uint256 underlyingValue;
            IWrappedfCash wfCash;
            Position memory position;

            // iterate all positions to get the rate
            for (uint i; i < length;) {
                maturity = markets[i];
                wfCash = _getWfCash(maturity);
                position = positions[maturity];

                if (wfCash.hasMatured()) {
                    // when position is matured, value is 1:1 with fCash
                    underlyingValue = position.fCash;
                }
                else {
                    // otherwise ask Notional the current value
                    underlyingValue = uint256(
                        notionalProxy.getPresentfCashValue(
                            currencyId,
                            maturity,
                            int88(int256(position.fCash)),
                            block.timestamp,
                            false
                        )
                    );
                }

                // accumulate all position's rates
                rate = rate
                // convert `underlyingValue` to percentage with D18
                + shiftl_toFix(
                    (underlyingValue * 1e18 / position.balance),
                    - int8(underlyingAsset.decimals())
                )
                // divide to get range from 0 to 1
                / 100;

            unchecked {
                i = i + 1;
            }
            }

            // rate is: last stored + current average - one
            // we subtract one to the average to get the
            // current increment from a base unit, which
            // then is added to the previous value.
            // This way we get a smooth curve
            rate = lastRefPerTok + (rate / length) - 1e18;
        }
    }

    /// @notice Checks every position the account is in, and if any of the markets
    ///   has matured, redeems the underlying assets and re-lends everything again
    function reinvest() external {
        uint256 marketsLength = markets.length;
        if (marketsLength == 0) return;

        IWrappedfCash wfCash;
        uint256 maturity;

        for (uint i; i < marketsLength;) {
            maturity = markets[i];
            wfCash = _getWfCash(maturity);
            // checks if this market has matured
            if (wfCash.hasMatured()) {
                // make sure Notional markets for this currency are initialized
                // this function is expensive to run if the markets have not been rolled out
                // normally other keepers or arbitrageurs take care of it, but if we get
                // the first here, we have to make sure it is initialized.
                // Once initialized the function simply returns;
                notionalProxy.initializeMarkets(currencyId, false);
                // reinvest assets on this market
                _reinvest(wfCash);
                // delete state of this maturity
                delete positions[maturity];
                delete enabledMarkets[maturity];
                // `_reinvest` may or may not add a market, depending on if the most profitable
                // it already existed,
                // so in order to remove the matured market from the array, gotta check lengths
                if (markets.length == marketsLength) {
                    // reinvestment went into an already existing market
                    // move the last element into the position and decrease total length
                    markets[i] = markets[marketsLength - 1];
                    marketsLength = marketsLength - 1;
                }
                else {
                    // reinvestment went into a new market
                    // move the _real_ last element, and not decreasing total length since +1-1=0
                    markets[i] = markets[markets.length - 1];
                }
                // remove last element
                markets.pop();
                // Since we are removing a market we dont want
                // to increase the counter when we find a matured market
            }
            else {
                // if market didn't mature increase the counter.
            unchecked {
                i = i + 1;
            }
            }
        }
    }

    /// @notice Deposits `amount` into the most profitable market at this time
    function deposit(uint256 amount) external {
        require(amount > 0, "empty deposit amount");

        Market memory market = _getMostProfitableMarket();

        _depositByUser(amount, market);
    }

    /// @notice Deposits `amount` into the given market `maturity`
    /// @dev With this users can choose which market they enter to,
    ///   it will revert if the given maturity is not available
    function depositTo(uint256 amount, uint256 maturity) external {
        require(amount > 0, "empty deposit amount");
        require(maturity > 0, "unspecified maturity");

        Market memory market = _getMarket(maturity);
        require(market.maturity > 0, "market not found");

        _depositByUser(amount, market);
    }

    /// @notice Withdraws `amount` of balance from the account
    /// @dev This function may remove market positions
    function withdraw(uint256 amount) external {
        require(amount > 0, "empty withdraw amount");
        require(balanceOf(_msgSender()) >= amount, "not enough balance");

        // compute the percentage that `amount` represents of the total
        uint256 percentageToWithdraw = amount * 1e18 / totalSupply();

        // checks if we are removing everything remaining
        if (percentageToWithdraw == 1e18) {
            // in which case we have to store the current `refPerTok`
            lastRefPerTok = refPerTok();
        }

        // iterate over all the existing markets
        uint256 marketsLength = markets.length;
        for (uint i; i < marketsLength;) {
            // get maturity of current market
            uint256 maturity = markets[i];
            // withdraw percentage from this market
            _withdraw(percentageToWithdraw, maturity);
            // check if market has to be deleted
            if (percentageToWithdraw == 1e18) {
                delete positions[maturity];
                delete enabledMarkets[maturity];
            }
        unchecked {
            i = i + 1;
        }
        }

        // burn the local tokens
        _burn(_msgSender(), amount);

        // clean markets if everything is gone
        if (percentageToWithdraw == 1e18) {
            delete markets;
        }
    }

    /** Getters **/

    /// @notice Returns the current active markets on Notional for this currency
    function availableMarkets() external view returns (Market[] memory _availableMarkets) {
        INotionalProxy.MarketParameters[] memory _marketsList = notionalProxy.getActiveMarkets(currencyId);
        uint256 length = _marketsList.length;
        require(length > 0, 'no available markets');

        _availableMarkets = new Market[](length);

        for (uint i = 0; i < length; i++) {
            _availableMarkets[i] = Market(
                _marketsList[i].maturity,
                _getMonthsTenor(i),
                _marketsList[i].oracleRate
            );
        }
    }

    /// @notice Returns the markets that has open positions
    function activeMarkets() external view returns (uint256[] memory) {
        return markets;
    }

    /// @notice Checks if any position in the market is already mature
    function hasMatured() external view returns (bool) {
        uint256 length = markets.length;
        for (uint i; i < length; i++) {
            IWrappedfCash wfCash = _getWfCash(markets[i]);
            if (wfCash.hasMatured()) {
                // since markets are ordered
                // we can return true on first find
                return true;
            }
        }
        return false;
    }

    /// @notice Returns the amounts of fCash tokens owned by the contract
    ///   this tokens represent the sum of all positions on Notional lending markets
    function positionsAmount() external view returns (uint256 amount) {
        uint256 length = markets.length;
        for (uint i; i < length; i++) {
            amount = amount + positions[markets[i]].fCash;
        }
    }

    /// @notice Returns the address of the managed underlying asset
    function underlying() external view returns (address) {
        return address(underlyingAsset);
    }

    /** Private helpers **/

    /// Deposits `amount` into a specific market
    ///
    /// @param amount The amount to deposit
    /// @param market The market to enter
    ///
    /// @dev This function may create new market positions
    function _depositByUser(uint256 amount, Market memory market) private {
        // transfer assets from user
        underlyingAsset.safeTransferFrom(_msgSender(), address(this), amount);

        // get/deploy Notional wrapped contract
        IWrappedfCash wfCash = IWrappedfCash(
            wfCashFactory.deployWrapper(currencyId, uint40(market.maturity))
        );

        // ask Notional how much fCash we should receive for our assets
        (uint88 fCashAmount,,) = notionalProxy.getfCashLendFromDeposit(
            currencyId, amount, market.maturity, 0, block.timestamp, true
        );

        // compute the tokens to be given to the user based on the current `refPerTok`
        uint256 tokensToMint = shiftl_toFix(
            uint256(fCashAmount) * 1e18 / refPerTok(),
            - int8(wfCash.decimals())
        );

        // create/update position
        _addPosition(
            market.maturity,
            Position(
                fCashAmount,
                tokensToMint
            )
        );

        // mint wfCash
        underlyingAsset.safeApprove(address(wfCash), amount);
        wfCash.mintViaUnderlying(amount, fCashAmount, address(this), 0);

        // mint local tokens
        _mint(_msgSender(), tokensToMint);
    }

    /// Adds a position
    ///
    /// @param maturity The maturity of the market to add the position
    /// @param position The position with the details
    ///
    /// @dev Here we will create/update the market position
    function _addPosition(uint256 maturity, Position memory position) private {
        if (enabledMarkets[maturity]) {
            // update global position
            positions[maturity].fCash = positions[maturity].fCash + position.fCash;
            positions[maturity].balance = positions[maturity].balance + position.balance;
        }
        else {
            // add position to global data
            enabledMarkets[maturity] = true;
            positions[maturity] = position;
            markets.push(maturity);
        }
    }

    /// Withdraws `percentage` of a given market `maturity`
    /// @param percentage Portion of the fCash to redeem
    /// @param maturity Maturity of the market we want to redeem from
    function _withdraw(uint256 percentage, uint256 maturity) private {
        // fetch current balances
        uint256 currentfCash = positions[maturity].fCash;
        uint256 currentBalance = positions[maturity].balance;

        // compute amount to redeem
        uint256 fCashToRedeem = currentfCash * percentage / 1e18;
        uint256 balanceToRedeem = currentBalance * percentage / 1e18;

        // update account state
        positions[maturity].fCash = currentfCash - fCashToRedeem;
        positions[maturity].balance = currentBalance - balanceToRedeem;

        // redeem to the user
        IWrappedfCash wfCash = _getWfCash(maturity);
        wfCash.redeemToUnderlying(fCashToRedeem, _msgSender(), 0);
    }

    /// Process the reinvestment of a certain market
    /// @param wfCash Market that we want to redeem and reinvest
    /// @dev This function removes a market, and may add one too
    function _reinvest(IWrappedfCash wfCash) private {
        // get current position
        uint256 maturity = wfCash.getMaturity();
        Position storage existingPosition = positions[maturity];

        // convert fCash amount to D18
        uint256 underlyingAmount = shiftl_toFix(
            existingPosition.fCash,
            int8(underlyingAsset.decimals()) - int8(wfCash.decimals()) - 18
        );

        // take everything out from Notional
        wfCash.redeemToUnderlying(existingPosition.fCash, address(this), 0);

        // get new market
        Market memory bestMarket = _getMostProfitableMarket();

        // ask Notional how much fCash we should receive for our assets
        (uint88 newfCashAmount,,) = notionalProxy.getfCashLendFromDeposit(
            currencyId, underlyingAmount, bestMarket.maturity, 0, block.timestamp, true
        );

        // get/deploy new wrapper
        wfCash = IWrappedfCash(
            wfCashFactory.deployWrapper(currencyId, uint40(bestMarket.maturity))
        );

        // create/update position
        _addPosition(
            bestMarket.maturity,
            Position(
                newfCashAmount,
                existingPosition.balance
            )
        );

        // mint wfCash
        underlyingAsset.approve(address(wfCash), underlyingAmount);
        wfCash.mintViaUnderlying(underlyingAmount, newfCashAmount, address(this), 0);
    }

    /// Return an instance to Notional's wfCash contract of the given maturity
    function _getWfCash(uint256 maturity) internal view returns (IWrappedfCash wfCash){
        wfCash = IWrappedfCash(
            wfCashFactory.computeAddress(currencyId, uint40(maturity))
        );
        return wfCash;
    }

    /// Fetch all markets and returns the most profitable one
    /// @return selectedMarket The market with the best rate at the moment
    function _getMostProfitableMarket() private view returns (Market memory selectedMarket) {
        INotionalProxy.MarketParameters[] memory _availableMarkets = notionalProxy.getActiveMarkets(currencyId);
        uint256 length = _availableMarkets.length;
        require(length > 0, 'no available markets');

        uint256 biggestRate;

        for (uint i = 0; i < length;) {
            if (_availableMarkets[i].oracleRate > biggestRate) {
                biggestRate = _availableMarkets[i].oracleRate;
                selectedMarket.maturity = _availableMarkets[i].maturity;
                selectedMarket.monthsTenor = _getMonthsTenor(i);
                selectedMarket.rate = _availableMarkets[i].oracleRate;
            }
        unchecked {
            i = i + 1;
        }
        }
    }

    /// Fetch all markets and returns the one with the selected maturity
    /// @return selectedMarket The market with the selected maturity
    function _getMarket(uint256 maturity) private view returns (Market memory selectedMarket) {
        INotionalProxy.MarketParameters[] memory _availableMarkets = notionalProxy.getActiveMarkets(currencyId);
        uint256 length = _availableMarkets.length;
        require(length > 0, 'no available markets');

        for (uint i = 0; i < length;) {
            if (_availableMarkets[i].maturity == maturity) {
                selectedMarket.maturity = _availableMarkets[i].maturity;
                selectedMarket.monthsTenor = _getMonthsTenor(i);
                selectedMarket.rate = _availableMarkets[i].oracleRate;
            }
        unchecked {
            i = i + 1;
        }
        }
    }

    /// @param index The market index to be checked
    /// @return months Number of months of this tenor
    /// @dev markets always come ordered and are enabled from short to long
    function _getMonthsTenor(uint256 index) private pure returns (uint8 months) {
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
}
