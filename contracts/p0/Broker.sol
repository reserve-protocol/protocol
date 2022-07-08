// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/plugins/trading/GnosisTrade.sol";
import "contracts/interfaces/IBroker.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/ITrade.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/mixins/Component.sol";

/// A simple core contract that deploys disposable trading contracts for Traders
contract BrokerP0 is ComponentP0, IBroker {
    using FixLib for uint192;
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20Metadata;

    // The fraction of the supply of the bidding token that is the min bid size in case of default
    uint192 public constant MIN_BID_SHARE_OF_TOTAL_SUPPLY = 1e9; // (1} = 1e-7%

    IGnosis public gnosis;

    mapping(address => bool) private trades;

    uint32 public auctionLength; // {s} the length of an auction

    uint192 public minBidSize; // {UoA} The minimum size of a bid during auctions

    bool public disabled;

    function init(
        IMain main_,
        IGnosis gnosis_,
        ITrade, // Added for Interface compatibility with P1
        uint32 auctionLength_,
        uint192 minBidSize_
    ) public initializer {
        __Component_init(main_);
        gnosis = gnosis_;
        auctionLength = auctionLength_;
        minBidSize = minBidSize_;
    }

    /// Handle a trade request by deploying a customized disposable trading contract
    /// @dev Requires setting an allowance in advance
    /// @custom:protected
    function openTrade(TradeRequest memory req) external notPausedOrFrozen returns (ITrade) {
        require(!disabled, "broker disabled");
        assert(req.sellAmount > 0);

        address caller = _msgSender();
        require(
            caller == address(main.backingManager()) ||
                caller == address(main.rsrTrader()) ||
                caller == address(main.rTokenTrader()),
            "only traders"
        );

        // In the future we'll have more sophisticated choice logic here, probably by trade size
        GnosisTrade trade = new GnosisTrade();
        trades[address(trade)] = true;
        req.sell.erc20().safeTransferFrom(caller, address(trade), req.sellAmount);

        trade.init(this, caller, gnosis, auctionLength, minBidAmt(req.buy), req);
        return trade;
    }

    /// Disable the broker until re-enabled by governance
    /// @custom:protected
    function reportViolation() external notPausedOrFrozen {
        require(trades[_msgSender()], "unrecognized trade contract");
        emit DisabledSet(disabled, true);
        disabled = true;
    }

    // === Private ===

    /// @return minBidAmt_ {qTok} The minimum bid size for an asset
    function minBidAmt(IAsset asset) private view returns (uint256 minBidAmt_) {
        if (
            asset.isCollateral() &&
            ICollateral(address(asset)).status() != CollateralStatus.DISABLED
        ) {
            // {tok} = {UoA} / {UoA/tok}
            uint192 minBidSize_ = minBidSize.div(asset.price(), CEIL);

            // {qTok} = {tok} * {qTok/tok}
            minBidAmt_ = minBidSize_.shiftl_toUint(int8(asset.erc20().decimals()), CEIL);
        }

        if (minBidAmt_ == 0) {
            // {qTok} = {1} * {qTok}
            minBidAmt_ = MIN_BID_SHARE_OF_TOTAL_SUPPLY.mulu_toUint(
                asset.erc20().totalSupply(),
                CEIL
            );
        }
    }

    // === Setters ===

    /// @custom:governance
    function setAuctionLength(uint32 newAuctionLength) external governance {
        emit AuctionLengthSet(auctionLength, newAuctionLength);
        auctionLength = newAuctionLength;
    }

    /// @custom:governance
    function setMinBidSize(uint192 newMinBidSize) external governance {
        emit MinBidSizeSet(minBidSize, newMinBidSize);
        minBidSize = newMinBidSize;
    }

    /// @custom:governance
    function setDisabled(bool disabled_) external governance {
        emit DisabledSet(disabled, disabled_);
        disabled = disabled_;
    }
}
