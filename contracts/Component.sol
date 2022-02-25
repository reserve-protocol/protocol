// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/interfaces/IMain.sol";
// TODO We should be able to pull all non-implementation-specific types out here later

type AddrKey is bytes32;
type UintKey is bytes32;
type FixKey is bytes32;


/// An abstract base class for all component contracts to extend
abstract contract Component {

    // TODO
    // 1. Write out hashes directly and put expression in comments
    // 2. Reduce bytes32 to bytes   N (N = 4?)

    AddrKey internal constant REVENUE_FURNACE = AddrKey.wrap(bytes32(keccak256("REVENUE_FURNACE")));
    AddrKey internal constant MARKET = AddrKey.wrap(bytes32(keccak256("MARKET")));
    AddrKey internal constant RSR = AddrKey.wrap(bytes32(keccak256("MARKET")));
    AddrKey internal constant ST_RSR = AddrKey.wrap(bytes32(keccak256("ST_RSR")));
    AddrKey internal constant RTOKEN = AddrKey.wrap(bytes32(keccak256("RTOKEN")));

    UintKey internal constant REWARD_START = UintKey.wrap(bytes32(keccak256("REWARD_START")));
    UintKey internal constant REWARD_PERIOD = UintKey.wrap(bytes32(keccak256("REWARD_PERIOD")));
    UintKey internal constant AUCTION_PERIOD = UintKey.wrap(bytes32(keccak256("AUCTION_PERIOD")));
    UintKey internal constant ST_RSR_PAY_PERIOD = UintKey.wrap(bytes32(keccak256("ST_RSR_PAY_PERIOD")));
    UintKey internal constant ST_RSR_WITHDRAWAL_DELAY = UintKey.wrap(bytes32(keccak256("ST_RSR_WITHDRAWAL_DELAY")));
    UintKey internal constant DEFAULT_DELAY = UintKey.wrap(bytes32(keccak256("DEFAULT_DELAY")));

    FixKey internal constant MAX_TRADE_SLIPPAGE = FixKey.wrap(bytes32(keccak256("MAX_TRADE_SLIPPAGE")));
    FixKey internal constant DUST_AMOUNT = FixKey.wrap(bytes32(keccak256("DUST_AMOUNT")));
    FixKey internal constant BACKING_BUFFER = FixKey.wrap(bytes32(keccak256("BACKING_BUFFER")));
    FixKey internal constant ISSUANCE_RATE = FixKey.wrap(bytes32(keccak256("ISSUANCE_RATE")));
    FixKey internal constant DEFAULT_THRESHOLD = FixKey.wrap(bytes32(keccak256("DEFAULT_THRESHOLD")));
    FixKey internal constant ST_RSR_PAY_RATIO = FixKey.wrap(bytes32(keccak256("ST_RSR_PAY_RATIO")));
    
    error ParameterizationError(bytes32);

    bool private _initialized;

    event Initialized();

    function init(ConstructorArgs calldata) public virtual {
        require(!_initialized, "already initialized");
        _initialized = true;
        emit Initialized();
    }
}
