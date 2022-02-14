// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/interfaces/IMain.sol";
import "./Lib.sol";

/// Address-abstracted accounts
enum Account {
    ALICE, // 0
    BOB,
    CHARLIE,
    DAVE,
    EVE,
    TRADER,
    // Below: contract accounts only
    RTOKEN,
    STRSR,
    MAIN // 8
}

/// All assets in the system
/// Only the first 11 are collateral-eligible
enum AssetName {
    DAI, // 0
    USDC, // 1
    USDT, // 2
    BUSD, // 3
    cDAI, // 4
    cUSDC, // 5
    cUSDT, // 6
    aDAI, // 7
    aUSDC, // 8
    aUSDT, // 9
    aBUSD, // 10
    // Below: not collateral eligible
    RSR, // 11
    COMP, // 12
    AAVE // 13
}

struct Price {
    uint256 inETH; // {qETH/tok}
    uint256 inUoA; // {microUoA/tok}
}

/// How revenue is to be distributed
struct RevenueDestination {
    address dest;
    uint16 rTokenDist;
    uint16 rsrDist;
}

struct BasketConfig {
    uint256 maxCollateral; // Maximum number of backup collateral elements to use in a basket
    AssetName[] collateral; // Ordered list of backup collateral
    Fix[] targetAmts; // {target/BU}
}

struct RToken {
    AssetName[] collateral;
    uint256[] amts; // {qTok/rTok}
    TokenState erc20;
}

struct StRSR {
    TokenState erc20;
}

struct TokenState {
    string name;
    string symbol;
    uint256[] balances; // balances[Account] = uint256
    uint256 totalSupply;
    //
    Price price;
}

struct Protocol {
    Config config;
    RevenueDestination[] distribution;
    RToken rToken;
    StRSR stRSR;
    BasketConfig basketConfig;
}

struct Environment {
    TokenState[] assets; // AssetName.DAI - AssetName.AAVE
    Fix[] rateToRef; // AssetName.DAI - AssetName.BUSD only
    Price ethPrice;
}

/// Top-level state struct
struct ProtoState {
    Protocol protocol;
    Environment environ;
}
