// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/IMain.sol";
import "./Lib.sol";

/// Address-abstracted accounts
enum Account {
    ALICE, // 0
    BOB,
    CHARLIE,
    DAVE,
    EVE,
    //
    RTOKEN,
    STRSR,
    MAIN // 7
}

/// All eligible collateral
enum CollateralToken {
    DAI, // 0
    USDC,
    USDT,
    BUSD,
    cDAI,
    cUSDC,
    cUSDT,
    aDAI,
    aUSDC,
    aUSDT,
    aBUSD // 10
}

/// Basket Unit, ie 1e18{qBU}
struct BU {
    CollateralToken[] tokens;
    uint256[] quantities; // {qTok/RToken}
}

/// Only one of these prices below
struct OraclePrice {
    uint256 inETH; // {qETH/tok}
    uint256 inUSD; // {microUSD/tok}
}

struct TokenState {
    string name;
    string symbol;
    uint256[][] allowances; // allowances[Account owner][Account spender] = uint256
    uint256[] balances; // balances[Account] = uint256
    uint256 totalSupply;
    //
    OraclePrice price;
}

/// Top-level state struct
struct ProtoState {
    // System-internal state
    Config config;
    BU rTokenDefinition;
    TokenState rToken;
    TokenState rsr;
    TokenState stRSR;
    BU[] bu_s; // The definition of 1e18{qBU} basket units for all vaults in the vault stick-DAG
    // System-external state
    TokenState comp;
    TokenState aave;
    TokenState[] collateral; // same length and order as CollateralToken enum
    OraclePrice ethPrice; // use the USD sub-field
}
