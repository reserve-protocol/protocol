// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Types shared by BasketHandlers and the BasketLib

struct BackupConfig {
    uint256 max; // Maximum number of backup collateral erc20s to use in a basket
    IERC20[] erc20s; // Ordered list of backup collateral ERC20s
}

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

/// A reference basket that provides a dynamic definition of a basket unit (BU)
/// Can be empty if all collateral defaults
struct Basket {
    IERC20[] erc20s; // Weak Invariant: after `refreshBasket`, no bad collateral || disabled
    mapping(IERC20 => uint192) refAmts; // {ref/BU}
    uint48 nonce;
    uint48 timestamp;
    bool disabled;
    // Invariant: targetAmts == refAmts.map(amt => amt * coll.targetPerRef()) || disabled
}
