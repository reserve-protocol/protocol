// SPDX-License-Identifier: ISC
pragma solidity 0.8.19;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "contracts/libraries/Fixed.sol";

// solhint-disable func-param-name-mixedcase, func-name-mixedcase
interface ICurvePool {
    // reentrancy check -- use with ETH / WETH pools
    function claim_admin_fees() external;

    function remove_liquidity(
        uint256 _amount,
        uint256[2] calldata min_amounts,
        bool use_eth,
        address receiver
    ) external;

    // For Curve Plain Pools and V2 Metapools
    function coins(uint256) external view returns (address);

    // Only exists in Curve Lending Pools; not used currently
    function underlying_coins(uint256) external view returns (address);

    // Only exists in V1 Curve Metapools; not used currently
    function base_coins(uint256) external view returns (address);

    function balances(uint256) external view returns (uint256);

    function get_virtual_price() external view returns (uint256);

    function token() external view returns (address);
}

/// Supports Curve base pools for up to 4 tokens
contract PoolTokens {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    error WrongIndex(uint8 maxLength);
    error NoToken(uint8 tokenNumber);

    enum CurvePoolType {
        Plain,
        Lending, // not supported in this version
        Metapool // not supported via this class. parent class handles metapool math
    }

    // === State (Immutable) ===

    ICurvePool public immutable curvePool;
    IERC20Metadata public immutable lpToken;
    uint8 internal immutable nTokens;

    IERC20Metadata internal immutable token0;
    IERC20Metadata internal immutable token1;
    IERC20Metadata internal immutable token2;
    IERC20Metadata internal immutable token3;

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

    AggregatorV3Interface internal immutable _t2feed0;
    AggregatorV3Interface internal immutable _t2feed1;
    uint48 internal immutable _t2timeout0; // {s}
    uint48 internal immutable _t2timeout1; // {s}
    uint192 internal immutable _t2error0; // {1}
    uint192 internal immutable _t2error1; // {1}

    AggregatorV3Interface internal immutable _t3feed0;
    AggregatorV3Interface internal immutable _t3feed1;
    uint48 internal immutable _t3timeout0; // {s}
    uint48 internal immutable _t3timeout1; // {s}
    uint192 internal immutable _t3error0; // {1}
    uint192 internal immutable _t3error1; // {1}

    // === Config ===

    struct PTConfiguration {
        uint8 nTokens;
        ICurvePool curvePool;
        IERC20Metadata lpToken;
        CurvePoolType poolType;
        AggregatorV3Interface[][] feeds; // row should multiply to give {UoA/ref}; max columns is 2
        uint48[][] oracleTimeouts; // {s} same order as feeds
        uint192[][] oracleErrors; // {1} same order as feeds
    }

    constructor(PTConfiguration memory config) {
        require(config.nTokens <= 4, "up to 4 tokens max");
        require(maxFeedsLength(config.feeds) <= 2, "price feeds limited to 2");
        require(
            config.feeds.length == config.nTokens && minFeedsLength(config.feeds) != 0,
            "each token needs at least 1 price feed"
        );
        require(address(config.curvePool) != address(0), "curvePool address is zero");

        curvePool = config.curvePool;
        nTokens = config.nTokens;
        lpToken = config.lpToken;

        // Solidity does not support immutable arrays. This is a hack to get the equivalent of
        // an immutable array so we do not have store the token feeds in the blockchain. This is
        // a gas optimization since it is significantly more expensive to read and write on the
        // blockchain than it is to use embedded values in the bytecode.

        // === Tokens ===

        IERC20Metadata[] memory tokens = new IERC20Metadata[](nTokens);
        for (uint8 i = 0; i < nTokens; ++i) {
            if (config.poolType == CurvePoolType.Plain) {
                tokens[i] = IERC20Metadata(curvePool.coins(i));
            } else {
                revert("invalid poolType");
            }
        }

        token0 = tokens[0];
        token1 = tokens[1];
        token2 = (nTokens > 2) ? tokens[2] : IERC20Metadata(address(0));
        token3 = (nTokens > 3) ? tokens[3] : IERC20Metadata(address(0));

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

        // token2
        more = config.feeds.length > 2 && config.feeds[2].length != 0;
        _t2feed0 = more ? config.feeds[2][0] : AggregatorV3Interface(address(0));
        _t2timeout0 = more && config.oracleTimeouts[2].length != 0
            ? config.oracleTimeouts[2][0]
            : 0;
        _t2error0 = more && config.oracleErrors[2].length != 0 ? config.oracleErrors[2][0] : 0;
        if (more) {
            require(address(_t2feed0) != address(0), "t2feed0 empty");
            require(_t2timeout0 != 0, "t2timeout0 zero");
            require(_t2error0 < FIX_ONE, "t2error0 too large");
        }

        more = config.feeds.length > 2 && config.feeds[2].length > 1;
        _t2feed1 = more ? config.feeds[2][1] : AggregatorV3Interface(address(0));
        _t2timeout1 = more && config.oracleTimeouts[2].length > 1 ? config.oracleTimeouts[2][1] : 0;
        _t2error1 = more && config.oracleErrors[2].length > 1 ? config.oracleErrors[2][1] : 0;
        if (more) {
            require(address(_t2feed1) != address(0), "t2feed1 empty");
            require(_t2timeout1 != 0, "t2timeout1 zero");
            require(_t2error1 < FIX_ONE, "t2error1 too large");
        }

        // token3
        more = config.feeds.length > 3 && config.feeds[3].length != 0;
        _t3feed0 = more ? config.feeds[3][0] : AggregatorV3Interface(address(0));
        _t3timeout0 = more && config.oracleTimeouts[3].length != 0
            ? config.oracleTimeouts[3][0]
            : 0;
        _t3error0 = more && config.oracleErrors[3].length != 0 ? config.oracleErrors[3][0] : 0;
        if (more) {
            require(address(_t3feed0) != address(0), "t3feed0 empty");
            require(_t3timeout0 != 0, "t3timeout0 zero");
            require(_t3error0 < FIX_ONE, "t3error0 too large");
        }

        more = config.feeds.length > 3 && config.feeds[3].length > 1;
        _t3feed1 = more ? config.feeds[3][1] : AggregatorV3Interface(address(0));
        _t3timeout1 = more && config.oracleTimeouts[3].length > 1 ? config.oracleTimeouts[3][1] : 0;
        _t3error1 = more && config.oracleErrors[3].length > 1 ? config.oracleErrors[3][1] : 0;
        if (more) {
            require(address(_t3feed1) != address(0), "t3feed1 empty");
            require(_t3timeout1 != 0, "t3timeout1 zero");
            require(_t3error1 < FIX_ONE, "t3error1 too large");
        }
    }

    /// @dev Warning: Can revert
    /// @param index The index of the token: 0, 1, 2, or 3
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
        } else if (index == 1) {
            x = _t1feed0.price(_t1timeout0);
            xErr = _t1error0;
            if (address(_t1feed1) != address(0)) {
                y = _t1feed1.price(_t1timeout1);
                yErr = _t1error1;
            }
        } else if (index == 2) {
            x = _t2feed0.price(_t2timeout0);
            xErr = _t2error0;
            if (address(_t2feed1) != address(0)) {
                y = _t2feed1.price(_t2timeout1);
                yErr = _t2error1;
            }
        } else {
            x = _t3feed0.price(_t3timeout0);
            xErr = _t3error0;
            if (address(_t3feed1) != address(0)) {
                y = _t3feed1.price(_t3timeout1);
                yErr = _t3error1;
            }
        }

        return toRange(x, y, xErr, yErr);
    }

    // === Internal ===

    /// @dev Warning: Can revert
    /// @return low {UoA}
    /// @return high {UoA}
    function totalBalancesValue() internal view returns (uint192 low, uint192 high) {
        for (uint8 i = 0; i < nTokens; ++i) {
            IERC20Metadata token = getToken(i);
            uint192 balance = shiftl_toFix(curvePool.balances(i), -int8(token.decimals()), FLOOR);
            (uint192 lowP, uint192 highP) = tokenPrice(i);

            low += balance.mul(lowP, FLOOR);
            high += balance.mul(highP, CEIL);
        }
    }

    /// @return [{tok}]
    function getBalances() internal view virtual returns (uint192[] memory) {
        uint192[] memory balances = new uint192[](nTokens);

        for (uint8 i = 0; i < nTokens; ++i) {
            IERC20Metadata token = getToken(i);
            uint192 balance = shiftl_toFix(curvePool.balances(i), -int8(token.decimals()), FLOOR);
            balances[i] = (balance);
        }

        return balances;
    }

    function maxPoolOracleTimeout() internal view virtual returns (uint48) {
        return
            uint48(
                Math.max(
                    Math.max(
                        Math.max(_t0timeout0, _t1timeout0),
                        Math.max(_t2timeout0, _t3timeout0)
                    ),
                    Math.max(Math.max(_t0timeout1, _t1timeout1), Math.max(_t2timeout1, _t3timeout1))
                )
            );
    }

    // === Private ===

    function getToken(uint8 index) private view returns (IERC20Metadata) {
        // untestable:
        //      getToken is always called with a valid index
        if (index >= nTokens) revert WrongIndex(nTokens - 1);
        if (index == 0) return token0;
        if (index == 1) return token1;
        if (index == 2) return token2;
        return token3;
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
