// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/libraries/Oracle.sol";
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

struct GenericBasket {
    CollateralToken[] tokens;
    uint256[] quantities; // {qTok/RToken}
}

struct ERC20State {
    string name;
    string symbol;
    uint256[][] allowances; // allowances[Account owner][Account spender] = uint256
    uint256[] balances; // balances[Account] = uint256
    uint256 totalSupply;
}

/// Top-level state struct
struct ProtoState {
    // ==== Setup ====
    GenericBasket[] baskets; // not currently part of equality checks
    // Basket DAG
    // 0th index is assumed to be the initial backing

    // ==== Setup + Equality ====
    Config config;
    IComptroller comptroller;
    IAaveLendingPool aaveLendingPool;
    GenericBasket rTokenRedemption;
    ERC20State rToken;
    ERC20State rsr;
    ERC20State stRSR;
    ERC20State comp;
    ERC20State aave;
    ERC20State[] collateral; // same length and order as CollateralToken enum
}
