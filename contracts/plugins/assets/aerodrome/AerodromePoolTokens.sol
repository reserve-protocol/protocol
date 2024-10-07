// SPDX-License-Identifier: ISC
pragma solidity 0.8.19;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "contracts/libraries/Fixed.sol";
import "./vendor/IAeroPool.sol";

/// Supports Aerodrome stable pools (2 tokens)
contract AerodromePoolTokens {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    error WrongIndex(uint8 maxLength);
    error NoToken(uint8 tokenNumber);

    uint8 internal constant nTokens = 2;

    enum AeroPoolType {
        Stable,
        Volatile // not supported in this version
    }

    // === State (Immutable) ===

    IAeroPool public immutable pool;
    AeroPoolType public immutable poolType;

    IERC20Metadata internal immutable token0;
    IERC20Metadata internal immutable token1;

    // For each token, we maintain up to two feeds/timeouts/errors
    // The data below would normally be a struct, but we want bytecode substitution

    AggregatorV3Interface internal immutable _t0feed0;
    AggregatorV3Interface internal immutable _t0feed1;
    uint48 internal immutable _t0timeout0; // {s}
    uint48 internal immutable _t0timeout1; // {s}
    uint192 internal immutable _t0error0; // {1}
    uint192 internal immutable _t0error1; // {1}

    AggregatorV3Interface internal immutable _t1feed0;
    AggregatorV3Interface internal immutable _t1feed1;
    uint48 internal immutable _t1timeout0; // {s}
    uint48 internal immutable _t1timeout1; // {s}
    uint192 internal immutable _t1error0; // {1}
    uint192 internal immutable _t1error1; // {1}

    // === Config ===

    struct APTConfiguration {
        IAeroPool pool;
        AeroPoolType poolType;
        AggregatorV3Interface[][] feeds; // row should multiply to give {UoA/ref}; max columns is 2
        uint48[][] oracleTimeouts; // {s} same order as feeds
        uint192[][] oracleErrors; // {1} same order as feeds
    }

    constructor(APTConfiguration memory config) {
        require(maxFeedsLength(config.feeds) <= 2, "price feeds limited to 2");
        require(
            config.feeds.length == nTokens && minFeedsLength(config.feeds) != 0,
            "each token needs at least 1 price feed"
        );
        require(address(config.pool) != address(0), "pool address is zero");

        pool = config.pool;
        poolType = config.poolType;

        // Solidity does not support immutable arrays. This is a hack to get the equivalent of
        // an immutable array so we do not have store the token feeds in the blockchain. This is
        // a gas optimization since it is significantly more expensive to read and write on the
        // blockchain than it is to use embedded values in the bytecode.

        // === Tokens ===

        if (config.poolType != AeroPoolType.Stable || !config.pool.stable()) {
            revert("invalid poolType");
        }

        token0 = IERC20Metadata(pool.token0());
        token1 = IERC20Metadata(pool.token1());

        // === Feeds + timeouts ===
        // I know this section at-first looks verbose and silly, but it's actually well-justified:
        //   - immutable variables cannot be conditionally written to
        //   - a struct or an array would not be able to be immutable
        //   - immutable variables means values get in-lined in the bytecode

        // token0
        bool more = config.feeds[0].length != 0;
        // untestable:
        //     more will always be true based on previous feeds validations
        _t0feed0 = more ? config.feeds[0][0] : AggregatorV3Interface(address(0));
        _t0timeout0 = more && config.oracleTimeouts[0].length != 0
            ? config.oracleTimeouts[0][0]
            : 0;
        _t0error0 = more && config.oracleErrors[0].length != 0 ? config.oracleErrors[0][0] : 0;
        if (more) {
            require(address(_t0feed0) != address(0), "t0feed0 empty");
            require(_t0timeout0 != 0, "t0timeout0 zero");
            require(_t0error0 < FIX_ONE, "t0error0 too large");
        }

        more = config.feeds[0].length > 1;
        _t0feed1 = more ? config.feeds[0][1] : AggregatorV3Interface(address(0));
        _t0timeout1 = more && config.oracleTimeouts[0].length > 1 ? config.oracleTimeouts[0][1] : 0;
        _t0error1 = more && config.oracleErrors[0].length > 1 ? config.oracleErrors[0][1] : 0;
        if (more) {
            require(address(_t0feed1) != address(0), "t0feed1 empty");
            require(_t0timeout1 != 0, "t0timeout1 zero");
            require(_t0error1 < FIX_ONE, "t0error1 too large");
        }

        // token1
        // untestable:
        //     more will always be true based on previous feeds validations
        more = config.feeds[1].length != 0;
        _t1feed0 = more ? config.feeds[1][0] : AggregatorV3Interface(address(0));
        _t1timeout0 = more && config.oracleTimeouts[1].length != 0
            ? config.oracleTimeouts[1][0]
            : 0;
        _t1error0 = more && config.oracleErrors[1].length != 0 ? config.oracleErrors[1][0] : 0;
        if (more) {
            require(address(_t1feed0) != address(0), "t1feed0 empty");
            require(_t1timeout0 != 0, "t1timeout0 zero");
            require(_t1error0 < FIX_ONE, "t1error0 too large");
        }

        more = config.feeds[1].length > 1;
        _t1feed1 = more ? config.feeds[1][1] : AggregatorV3Interface(address(0));
        _t1timeout1 = more && config.oracleTimeouts[1].length > 1 ? config.oracleTimeouts[1][1] : 0;
        _t1error1 = more && config.oracleErrors[1].length > 1 ? config.oracleErrors[1][1] : 0;
        if (more) {
            require(address(_t1feed1) != address(0), "t1feed1 empty");
            require(_t1timeout1 != 0, "t1timeout1 zero");
            require(_t1error1 < FIX_ONE, "t1error1 too large");
        }
    }

    /// @dev Warning: Can revert
    /// @param index The index of the token: 0 or 1
    /// @return low {UoA/ref_index}
    /// @return high {UoA/ref_index}
    function tokenPrice(uint8 index) public view virtual returns (uint192 low, uint192 high) {
        if (index >= nTokens) revert WrongIndex(nTokens - 1);

        // Use only 1 feed if 2nd feed not defined
        // otherwise: multiply feeds together, e.g; {UoA/ref} = {UoA/target} * {target/ref}
        uint192 x;
        uint192 y = FIX_ONE;
        uint192 xErr; // {1}
        uint192 yErr; // {1}
        // if only 1 feed: `y` is FIX_ONE and `yErr` is 0

        if (index == 0) {
            x = _t0feed0.price(_t0timeout0);
            xErr = _t0error0;
            if (address(_t0feed1) != address(0)) {
                y = _t0feed1.price(_t0timeout1);
                yErr = _t0error1;
            }
        } else {
            x = _t1feed0.price(_t1timeout0);
            xErr = _t1error0;
            if (address(_t1feed1) != address(0)) {
                y = _t1feed1.price(_t1timeout1);
                yErr = _t1error1;
            }
        }

        return toRange(x, y, xErr, yErr);
    }

    /// @param index The index of the token: 0 or 1
    /// @return [{ref_index}]
    function tokenReserve(uint8 index) public view virtual returns (uint256) {
        if (index >= nTokens) revert WrongIndex(nTokens - 1);
        // Maybe also cache token decimals as immutable?
        IERC20Metadata tokenInterface = getToken(index);
        if (index == 0) {
            return shiftl_toFix(pool.reserve0(), -int8(tokenInterface.decimals()), FLOOR);
        }
        return shiftl_toFix(pool.reserve1(), -int8(tokenInterface.decimals()), FLOOR);
    }

    /// @param index The index of the token: 0 or 1
    /// @return [address of chainlink feeds]
    function tokenFeeds(uint8 index) public view virtual returns (AggregatorV3Interface[] memory) {
        if (index >= nTokens) revert WrongIndex(nTokens - 1);
        AggregatorV3Interface[] memory feeds = new AggregatorV3Interface[](2);
        if (index == 0) {
            feeds[0] = _t0feed0;
            feeds[1] = _t0feed1;
        } else {
            feeds[0] = _t1feed0;
            feeds[1] = _t1feed1;
        }
        return feeds;
    }

    // === Internal ===

    function maxPoolOracleTimeout() internal view virtual returns (uint48) {
        return
            uint48(
                Math.max(Math.max(_t0timeout0, _t1timeout0), Math.max(_t0timeout1, _t1timeout1))
            );
    }

    // === Private ===

    function getToken(uint8 index) private view returns (IERC20Metadata) {
        // untestable:
        //      getToken is always called with a valid index
        if (index >= nTokens) revert WrongIndex(nTokens - 1);
        if (index == 0) return token0;
        return token1;
    }

    function minFeedsLength(AggregatorV3Interface[][] memory feeds) private pure returns (uint8) {
        uint8 minLength = type(uint8).max;
        for (uint8 i = 0; i < feeds.length; ++i) {
            minLength = uint8(Math.min(minLength, feeds[i].length));
        }
        return minLength;
    }

    function maxFeedsLength(AggregatorV3Interface[][] memory feeds) private pure returns (uint8) {
        uint8 maxLength;
        for (uint8 i = 0; i < feeds.length; ++i) {
            maxLength = uint8(Math.max(maxLength, feeds[i].length));
        }
        return maxLength;
    }

    /// x and y can be any two fixes that can be multiplied
    /// @param xErr {1} error associated with x
    /// @param yErr {1} error associated with y
    /// returns low and high extremes of x * y, given errors
    function toRange(
        uint192 x,
        uint192 y,
        uint192 xErr,
        uint192 yErr
    ) private pure returns (uint192 low, uint192 high) {
        low = x.mul(FIX_ONE - xErr).mul(y.mul(FIX_ONE - yErr), FLOOR);
        high = x.mul(FIX_ONE + xErr).mul(y.mul(FIX_ONE + yErr), CEIL);
    }
}
