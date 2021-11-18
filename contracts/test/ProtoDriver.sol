// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./ProtoState.sol";

interface ProtoDriver {
    function init(ProtoState memory state) external;

    /// @dev view
    function state() external returns (ProtoState memory);

    // ==== COMMANDS ====

    function CMD_issue(Account account, uint256 amount) external;

    function CMD_redeem(Account account, uint256 amount) external;

    function CMD_checkForDefault(Account account) external;

    function CMD_poke(Account account) external;

    function CMD_stakeRSR(Account account, uint256 amount) external;

    function CMD_unstakeRSR(Account account, uint256 amount) external;

    function CMD_setRTokenForMelting(Account account, uint256 amount) external;

    function CMD_transferRToken(
        Account from,
        Account to,
        uint256 amount
    ) external;

    function CMD_transferRSR(
        Account from,
        Account to,
        uint256 amount
    ) external;

    function CMD_transferStRSR(
        Account from,
        Account to,
        uint256 amount
    ) external;

    // === INVARIANTS ====

    function INVARIANT_isFullyCapitalized() external view returns (bool);
    // ...more
}
