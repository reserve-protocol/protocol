// SPDX-License-Identifier: ISC
pragma solidity 0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "reserve/contracts/plugins/assets/OracleLib.sol";
import "reserve/contracts/libraries/Fixed.sol";
import "hardhat/console.sol";

interface ICurvePool {
    function coins(uint256) external view returns (address);

    // Only exists in Curve Lending Pools
    function underlying_coins(uint256) external view returns (address);

    // Only exists in Curve Metapools
    function base_coins(uint256) external view returns (address);

    function balances(uint256) external view returns (uint256);

    function get_virtual_price() external view returns (uint256);

    function token() external view returns (address);

    function exchange(
        int128,
        int128,
        uint256,
        uint256
    ) external;
}

contract CurvePoolTokens {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    error WrongIndex(uint8 maxLength);
    error NoToken(uint8 tokenNumber);

    uint8 constant MAX_UINT8 = 255;

    enum CurvePoolType {
        Plain,
        Lending,
        Metapool
    }

    struct PTConfiguration {
        ERC20 lpToken;
        uint8 nTokens;
        address[][] tokenFeeds;
        ICurvePool curvePool;
        CurvePoolType poolType;
        uint48 oracleTimeout;
    }

    uint48 public immutable oracleTimeout; // {s} Seconds that an oracle value is considered valid
    ICurvePool public immutable curvePool;

    ERC20 internal immutable token0;
    ERC20 internal immutable token1;
    ERC20 internal immutable token2;
    ERC20 internal immutable token3;
    uint8 internal immutable nTokens;

    AggregatorV3Interface internal immutable _t0feed0;
    AggregatorV3Interface internal immutable _t0feed1;
    AggregatorV3Interface internal immutable _t0feed2;

    AggregatorV3Interface internal immutable _t1feed0;
    AggregatorV3Interface internal immutable _t1feed1;
    AggregatorV3Interface internal immutable _t1feed2;

    AggregatorV3Interface internal immutable _t2feed0;
    AggregatorV3Interface internal immutable _t2feed1;
    AggregatorV3Interface internal immutable _t2feed2;

    AggregatorV3Interface internal immutable _t3feed0;
    AggregatorV3Interface internal immutable _t3feed1;
    AggregatorV3Interface internal immutable _t3feed2;

    uint8 internal immutable _t0feedsLength;
    uint8 internal immutable _t1feedsLength;
    uint8 internal immutable _t2feedsLength;
    uint8 internal immutable _t3feedsLength;

    constructor(PTConfiguration memory config) {
        require(config.oracleTimeout > 0, "oracleTimeout zero");
        require(maxFeedsLength(config.tokenFeeds) <= 3, "price feeds limited to 3");
        require(
            config.tokenFeeds.length == config.nTokens && minFeedsLength(config.tokenFeeds) > 0,
            "each token needs at least 1 price feed"
        );
        require(address(config.curvePool) != address(0), "curvePool address is zero");

        curvePool = config.curvePool;
        nTokens = config.nTokens;
        oracleTimeout = config.oracleTimeout;

        address[] memory poolTokens = new address[](nTokens);
        if (config.poolType == CurvePoolType.Plain) {
            poolTokens = getPoolTokens(nTokens, curvePool.coins);
        } else if (config.poolType == CurvePoolType.Lending) {
            poolTokens = getPoolTokens(nTokens, curvePool.underlying_coins);
        } else {
            poolTokens = getPoolTokens(nTokens, curvePool.base_coins);
        }

        // Solidity does not support immutable arrays. This is a hack to get the equivalent of
        // an immutable array so we do not have store the token feeds in the blockchain. This is
        // a gas optimization since it is significantly more expensive to read and write on the
        // blockchain than it is to use embedded values in the bytecode.
        token0 = ERC20(poolTokens[0]);
        address[] memory token0Feeds = config.tokenFeeds[0];
        _t0feed0 = AggregatorV3Interface(token0Feeds.length > 0 ? token0Feeds[0] : address(0));
        _t0feed1 = AggregatorV3Interface(token0Feeds.length > 1 ? token0Feeds[1] : address(0));
        _t0feed2 = AggregatorV3Interface(token0Feeds.length > 2 ? token0Feeds[2] : address(0));
        _t0feedsLength = uint8(token0Feeds.length);

        token1 = ERC20(poolTokens[1]);
        address[] memory token1Feeds = config.tokenFeeds[1];
        _t1feed0 = AggregatorV3Interface(token1Feeds.length > 0 ? token1Feeds[0] : address(0));
        _t1feed1 = AggregatorV3Interface(token1Feeds.length > 1 ? token1Feeds[1] : address(0));
        _t1feed2 = AggregatorV3Interface(token1Feeds.length > 2 ? token1Feeds[2] : address(0));
        _t1feedsLength = uint8(token1Feeds.length);

        token2 = ERC20(poolTokens.length > 2 ? poolTokens[2] : address(0));
        address[] memory token2Feeds = address(token2) != address(0)
            ? config.tokenFeeds[2]
            : new address[](0);
        _t2feed0 = AggregatorV3Interface(token2Feeds.length > 0 ? token2Feeds[0] : address(0));
        _t2feed1 = AggregatorV3Interface(token2Feeds.length > 1 ? token2Feeds[1] : address(0));
        _t2feed2 = AggregatorV3Interface(token2Feeds.length > 2 ? token2Feeds[2] : address(0));
        _t2feedsLength = uint8(token2Feeds.length);

        token3 = ERC20(poolTokens.length > 3 ? poolTokens[3] : address(0));
        address[] memory token3Feeds = address(token3) != address(0)
            ? config.tokenFeeds[3]
            : new address[](0);
        _t3feed0 = AggregatorV3Interface(token3Feeds.length > 0 ? token3Feeds[0] : address(0));
        _t3feed1 = AggregatorV3Interface(token3Feeds.length > 1 ? token3Feeds[1] : address(0));
        _t3feed2 = AggregatorV3Interface(token3Feeds.length > 2 ? token3Feeds[2] : address(0));
        _t3feedsLength = uint8(token3Feeds.length);
    }

    function totalBalancesValue() public view returns (uint192) {
        uint192 totalBalances = 0;

        for (uint8 i = 0; i < nTokens; i++) {
            ERC20 token = getToken(i);
            uint192 balance = shiftl_toFix(curvePool.balances(i), -int8(token.decimals()));
            totalBalances += balance.mul(tokenPrice(i));
        }

        return totalBalances;
    }

    function getPoolTokens(
        uint8 _nTokens,
        function(uint256) external view returns (address) getCoin
    ) internal view returns (address[] memory) {
        address[] memory poolTokens = new address[](_nTokens);
        for (uint8 i = 0; i < _nTokens; i++) {
            poolTokens[i] = getCoin(i);
        }
        return poolTokens;
    }

    function getBalances() public view returns (uint192[] memory) {
        uint192[] memory balances = new uint192[](nTokens);

        for (uint8 i = 0; i < nTokens; i++) {
            ERC20 token = getToken(i);
            uint192 balance = shiftl_toFix(curvePool.balances(i), -int8(token.decimals()));
            balances[i] = (balance);
        }

        return balances;
    }

    function getToken(uint8 index) public view returns (ERC20) {
        if (index >= nTokens) revert WrongIndex(nTokens - 1);
        if (index == 0) return token0;
        if (index == 1) return token1;
        if (index == 2) return token2;
        return token3;
    }

    function tokenPrice(uint8 index) public view returns (uint192) {
        if (index >= nTokens) revert WrongIndex(nTokens - 1);
        if (index == 0) return token0price();
        if (index == 1) return token1price();
        if (index == 2) return token2price();
        return token3price();
    }

    function token0price() public view returns (uint192) {
        uint192 _price = FIX_ONE;
        for (uint8 i = 0; i < _t0feedsLength; i++) {
            _price = getToken0feed(i).price(oracleTimeout).mul(_price);
        }
        return _price;
    }

    function getToken0feed(uint8 index) public view returns (AggregatorV3Interface) {
        if (index >= _t0feedsLength) revert WrongIndex(_t0feedsLength);
        if (index == 0) return _t0feed0;
        if (index == 1) return _t0feed1;
        return _t0feed2;
    }

    function token1price() public view returns (uint192) {
        uint192 _price = FIX_ONE;
        for (uint8 i = 0; i < _t1feedsLength; i++) {
            _price = getToken1feed(i).price(oracleTimeout).mul(_price);
        }
        return _price;
    }

    function getToken1feed(uint8 index) public view returns (AggregatorV3Interface) {
        if (index >= _t1feedsLength) revert WrongIndex(_t1feedsLength - 1);
        if (index == 0) return _t1feed0;
        if (index == 1) return _t1feed1;
        return _t1feed2;
    }

    function token2price() public view returns (uint192) {
        if (address(token2) == address(0)) revert NoToken(2);
        uint192 _price = FIX_ONE;
        for (uint8 i = 0; i < _t2feedsLength; i++) {
            _price = getToken2feed(i).price(oracleTimeout).mul(_price);
        }
        return _price;
    }

    function getToken2feed(uint8 index) public view returns (AggregatorV3Interface) {
        if (index >= _t2feedsLength) revert WrongIndex(_t2feedsLength - 1);
        if (index == 0) return _t2feed0;
        if (index == 1) return _t2feed1;
        return _t2feed2;
    }

    function token3price() public view returns (uint192) {
        if (address(token3) == address(0)) revert NoToken(3);
        uint192 _price = FIX_ONE;
        for (uint8 i = 0; i < _t3feedsLength; i++) {
            _price = getToken3feed(i).price(oracleTimeout).mul(_price);
        }
        return _price;
    }

    function getToken3feed(uint8 index) public view returns (AggregatorV3Interface) {
        if (index >= _t3feedsLength) revert WrongIndex(_t3feedsLength - 1);
        if (index == 0) return _t3feed0;
        if (index == 1) return _t3feed1;
        return _t3feed2;
    }

    function minFeedsLength(address[][] memory tokenFeeds) internal pure returns (uint8) {
        uint8 minLength = MAX_UINT8;
        for (uint8 i = 0; i < tokenFeeds.length; i++) {
            minLength = uint8(Math.min(minLength, tokenFeeds[i].length));
        }
        return minLength;
    }

    function maxFeedsLength(address[][] memory tokenFeeds) internal pure returns (uint8) {
        uint8 maxLength;
        for (uint8 i = 0; i < tokenFeeds.length; i++) {
            maxLength = uint8(Math.max(maxLength, tokenFeeds[i].length));
        }
        return maxLength;
    }
}
