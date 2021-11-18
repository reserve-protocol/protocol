// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/test/ProtoState.sol";

import "hardhat/console.sol";

library Lib {
    /// uint version
    /// @param str A human-readable prefix to accompany the error message
    /// @return Returns whether the uints match or not
    function eq(
        uint256 a,
        uint256 b,
        string memory str
    ) internal view returns (bool) {
        if (a != b) {
            console.log(string(abi.encodePacked(str, " | %s != %s")), a, b);
            return false;
        }
        return true;
    }

    /// str version
    /// @param str A human-readable prefix to accompany the error message
    /// @return Returns whether the strings match or not
    function eq(
        string memory a,
        string memory b,
        string memory str
    ) internal view returns (bool) {
        if (keccak256(bytes(a)) != keccak256(bytes(b))) {
            console.log(string(abi.encodePacked(str, " | %s != %s")), a, b);
            return false;
        }
        return true;
    }

    /// ProtoState version
    /// Compares ProtoStates for equality
    function eq(ProtoState memory a, ProtoState memory b) internal returns (bool ok) {
        ok =
            _eqBasket(a.rTokenRedemption, b.rTokenRedemption) &&
            _eqERC20State(a.rToken, b.rToken, "RToken") &&
            _eqERC20State(a.rsr, b.rsr, "RSR") &&
            _eqERC20State(a.stRSR, b.stRSR, "stRSR") &&
            _eqERC20State(a.comp, b.comp, "COMP") &&
            _eqERC20State(a.aave, b.aave, "AAVE") &&
            eq(a.collateral.length, b.collateral.length, "Collateral length mismatch");
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
            eq(a.name, b.name, "Name mismatch") &&
            eq(a.symbol, b.symbol, "Symbol mismatch") &&
            eq(a.totalSupply, b.totalSupply, "TotalSupply mismatch") &&
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
            eq(a[uint256(Account.ALICE)], b[uint256(Account.ALICE)], "Alice bal mismatch") &&
            eq(a[uint256(Account.BOB)], b[uint256(Account.BOB)], "Bob bal mismatch") &&
            eq(a[uint256(Account.CHARLIE)], b[uint256(Account.CHARLIE)], "Charlie bal mismatch") &&
            eq(a[uint256(Account.DAVE)], b[uint256(Account.DAVE)], "Dave bal mismatch") &&
            eq(a[uint256(Account.EVE)], b[uint256(Account.EVE)], "Eve bal mismatch");
        if (!ok) {
            console.log("Token: %s", symbol);
        }
    }

    /// @return ok Returns whether two baskets are equal
    function _eqBasket(GenericBasket memory a, GenericBasket memory b) internal view returns (bool ok) {
        ok =
            eq(a.tokens.length, b.tokens.length, "Tokens size mismatch") &&
            eq(a.quantities.length, b.quantities.length, "Quantities size mismatch") &&
            eq(a.tokens.length, a.quantities.length, "invalid input");
        if (!ok) {
            return false;
        }

        for (uint256 i = 0; i < a.quantities.length; i++) {
            // TODO: Do fuzzy check
            ok = eq(a.quantities[i], b.quantities[i], "Basket quantities mismatch");
            if (!ok) {
                console.log("Index: %s", i);
                return false;
            }
        }
    }
}
