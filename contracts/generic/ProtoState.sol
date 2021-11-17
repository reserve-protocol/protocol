// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

// import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/proto0/libraries/Oracle.sol";
import "contracts/proto0/interfaces/IMain.sol";
import "./Testing.sol";

enum DefiProtocol {
    COMPOUND,
    AAVE
}

enum Account {
    ALICE,
    BOB,
    CHARLIE,
    DAVE,
    EVE
}

enum CollateralToken {
    DAI,
    USDC,
    USDT,
    BUSD,
    cDAI,
    cUSDC,
    cUSDT,
    aDAI,
    aUSDC,
    aUSDT,
    aBUSD
}

// naming collision with `Basket` struct from IVault.sol
struct GenericBasket {
    CollateralToken[] tokens;
    uint256[] quantities; // {qTok/RToken}
}

struct ERC20State {
    string name;
    string symbol;
    uint256[] balances; // Account -> uint256
    uint256 totalSupply;
}

/// Top-level struct
struct ProtoState {
    // ==== Setup ==== //

    Config config;
    IComptroller comptroller;
    IAaveLendingPool aaveLendingPool;
    // Basket DAG
    // 0th index is assumed to be the initial backing
    GenericBasket[] baskets;
    // ==== Eq ==== //

    GenericBasket rTokenRedemptionValue;
    ERC20State rToken;
    ERC20State rsr;
    ERC20State stRSR;
    ERC20State comp;
    ERC20State aave;
    ERC20State[] collateral;
}

/// Provides comparison operations on ProtoStates
library ProtoStateLib {
    function eq(ProtoState memory a, ProtoState memory b) internal returns (bool) {
        bool ok = _eqBasket(a.rTokenRedemptionValue, b.rTokenRedemptionValue) &&
            _eqERC20State(a.rToken, b.rToken, "RToken") &&
            _eqERC20State(a.rsr, b.rsr, "RSR") &&
            _eqERC20State(a.stRSR, b.stRSR, "stRSR") &&
            _eqERC20State(a.comp, b.comp, "COMP") &&
            _eqERC20State(a.aave, b.aave, "AAVE") &&
            Testing.eq(a.collateral.length, b.collateral.length, "Collateral length mismatch");
        if (!ok) {
            return false;
        }

        // Collateral
        for (uint256 i = 0; i < a.collateral.length; i++) {
            ok = _eqERC20State(a.collateral[i], b.collateral[i], a.collateral[i].symbol);
        }
    }

    /// @return ok Returns whether two ERC20States are equal, including checking balances for known accounts.
    function _eqERC20State(
        ERC20State memory a,
        ERC20State memory b,
        string memory symbol
    ) internal view returns (bool ok) {
        ok =
            Testing.eq(a.name, b.name, "Name mismatch") &&
            Testing.eq(a.symbol, b.symbol, "Symbol mismatch") &&
            Testing.eq(a.totalSupply, b.totalSupply, "TotalSupply mismatch") &&
            _eqBalances(a.balances, b.balances, a.symbol);
        if (!ok) {
            console.log("Token: %s", symbol);
        }
    }

    /// @return ok Returns whether the balances mappings are equal for our enumerated accounts
    function _eqBalances(
        uint256[] memory a,
        uint256[] memory b,
        string memory symbol
    ) internal view returns (bool ok) {
        ok =
            Testing.eq(a[uint256(Account.ALICE)], b[uint256(Account.ALICE)], "Alice bal mismatch") &&
            Testing.eq(a[uint256(Account.BOB)], b[uint256(Account.BOB)], "Bob bal mismatch") &&
            Testing.eq(a[uint256(Account.CHARLIE)], b[uint256(Account.CHARLIE)], "Charlie bal mismatch") &&
            Testing.eq(a[uint256(Account.DAVE)], b[uint256(Account.DAVE)], "Dave bal mismatch") &&
            Testing.eq(a[uint256(Account.EVE)], b[uint256(Account.EVE)], "Eve bal mismatch");
        if (!ok) {
            console.log("Token: %s", symbol);
        }
    }

    /// @return ok Returns whether two baskets are equal
    function _eqBasket(GenericBasket memory a, GenericBasket memory b) internal view returns (bool ok) {
        ok =
            Testing.eq(a.tokens.length, b.tokens.length, "Tokens size mismatch") &&
            Testing.eq(a.quantities.length, b.quantities.length, "Quantities size mismatch") &&
            Testing.eq(a.tokens.length, a.quantities.length, "invalid input");
        if (!ok) {
            return false;
        }

        for (uint256 i = 0; i < a.quantities.length; i++) {
            // TODO: Do fuzzy check
            ok = Testing.eq(a.quantities[i], b.quantities[i], "Basket quantities mismatch");
            if (!ok) {
                console.log("Index: %s", i);
                return false;
            }
        }
    }
}
