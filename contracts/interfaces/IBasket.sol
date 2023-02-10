// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Types shared by BasketHandlers and the BasketLib

// A "valid collateral array" is a an IERC20[] value without rtoken, rsr, or any duplicate values

// A BackupConfig value is valid if erc20s is a valid collateral array
struct BackupConfig {
    uint256 max; // Maximum number of backup collateral erc20s to use in a basket
    IERC20[] erc20s; // Ordered list of backup collateral ERC20s
}

// What does a BasketConfig value mean?
//
// erc20s, targetAmts, and targetNames should be interpreted together.
// targetAmts[erc20] is the quantity of target units of erc20 that one BU should hold
// targetNames[erc20] is the name of erc20's target unit
// and then backups[tgt] is the BackupConfig to use for the target unit named tgt
//
// For any valid BasketConfig value:
//     erc20s == keys(targetAmts) == keys(targetNames)
//     if name is in values(targetNames), then backups[name] is a valid BackupConfig
//     erc20s is a valid collateral array
//
// TODO: keys(targetAmts) can be a strict superset of erc20s.
// Ticket: https://app.asana.com/0/1202557536393044/1203043664234027/f
// In the meantime, treat erc20s as the canonical set of keys for the target* maps
struct BasketConfig {
    // The collateral erc20s in the prime (explicitly governance-set) basket
    IERC20[] erc20s;
    // Amount of target units per basket for each prime collateral token. {target/BU}
    mapping(IERC20 => uint192) targetAmts;
    // Cached view of the target unit for each erc20 upon setup
    mapping(IERC20 => bytes32) targetNames;
    // Backup configurations, per target name.
    mapping(bytes32 => BackupConfig) backups;
}

/// The type of BasketHandler.basket.
/// Defines a basket unit (BU) in terms of reference amounts of underlying tokens
// Logically, basket is just a mapping of erc20 addresses to ref-unit amounts.
// In the analytical comments I'll just refer to it that way.
//
// A Basket is valid if erc20s is a valid collateral array and erc20s == keys(refAmts)
struct Basket {
    IERC20[] erc20s; // Weak Invariant: after `refreshBasket`, no bad collateral || disabled
    mapping(IERC20 => uint192) refAmts; // {ref/BU}
    // Invariant: targetAmts == refAmts.map(amt => amt * coll.targetPerRef()) || disabled
}
