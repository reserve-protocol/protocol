// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/BaseComponent.sol";

/// Settings mixin for Main
contract SettingsHandlerP0 is BaseComponent, Ownable, ISettingsHandler {
    using FixLib for Fix;

    mapping(AddrKey => address) private _addrs;

    mapping(UintKey => uint256) private _uints;

    mapping(FixKey => Fix) private _fixs;

    function init(ConstructorArgs calldata args) public virtual override {
        super.init(args);

        // Contracts
        _addrs[REVENUE_FURNACE] = address(args.furnace);
        _addrs[MARKET] = address(args.market);
        _addrs[RSR] = address(args.rsr);
        _addrs[ST_RSR] = address(args.stRSR);
        _addrs[RTOKEN] = address(args.rToken);

        // Uints
        _uints[REWARD_START] = args.config.rewardStart;
        _uints[REWARD_PERIOD] = args.config.rewardPeriod;
        _uints[AUCTION_PERIOD] = args.config.auctionPeriod;
        _uints[ST_RSR_PAY_PERIOD] = args.config.stRSRPayPeriod;
        _uints[ST_RSR_WITHDRAWAL_DELAY] = args.config.stRSRWithdrawalDelay;
        _uints[DEFAULT_DELAY] = args.config.defaultDelay;

        // Fixs
        _fixs[MAX_TRADE_SLIPPAGE] = args.config.maxTradeSlippage;
        _fixs[DUST_AMOUNT] = args.config.dustAmount;
        _fixs[BACKING_BUFFER] = args.config.backingBuffer;
        _fixs[ISSUANCE_RATE] = args.config.issuanceRate;
        _fixs[DEFAULT_THRESHOLD] = args.config.defaultThreshold;
        _fixs[ST_RSR_PAY_RATIO] = args.config.stRSRPayRatio;
    }

    /// Add `onlyOwner` checks and any key-specific post checks after the mutation
    modifier withPostChecks(bytes32 key) {
        require(owner() == _msgSender(), "Ownable: caller is not the owner");

        _;

        if (key == AddrKey.unwrap(REVENUE_FURNACE)) {
            checkRevenueFurnaceDuration();
        } else if (
            key == UintKey.unwrap(ST_RSR_PAY_PERIOD) ||
            key == UintKey.unwrap(ST_RSR_WITHDRAWAL_DELAY)
        ) {
            checkStRSRPeriodRelationships(UintKey.wrap(key));
        }
    }

    function setAddr(AddrKey key, address value) external withPostChecks(AddrKey.unwrap(key)) {
        emit AddressSet(key, _addrs[key], value);
        _addrs[key] = value;
    }

    function setUint(UintKey key, uint256 value) external withPostChecks(UintKey.unwrap(key)) {
        emit UintSet(key, _uints[key], value);
        _uints[key] = value;
    }

    function setFix(FixKey key, Fix value) external withPostChecks(FixKey.unwrap(key)) {
        emit FixSet(key, _fixs[key], value);
        _fixs[key] = value;
    }

    function addr(AddrKey key) public view override returns (address) {
        return _addrs[key];
    }

    // solhint-disable-next-line func-name-mixedcase
    function Uint(UintKey key) public view override returns (uint256) {
        return _uints[key];
    }

    function fix(FixKey key) public view override returns (Fix) {
        return _fixs[key];
    }

    // ==== Checks ====

    function checkRevenueFurnaceDuration() private view {
        if (IFurnace(_addrs[REVENUE_FURNACE]).batchDuration() != _uints[REWARD_PERIOD]) {
            revert ParameterizationError(AddrKey.unwrap(REVENUE_FURNACE));
        }
    }

    function checkStRSRPeriodRelationships(UintKey key) private view {
        if (_uints[ST_RSR_PAY_PERIOD] * 2 > _uints[ST_RSR_WITHDRAWAL_DELAY]) {
            revert ParameterizationError(UintKey.unwrap(key));
        }
    }
}
