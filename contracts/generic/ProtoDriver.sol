// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "./ProtoState.sol";

interface ProtoDriver {
    function constructor_() external; // suffix due to collision

    function init(ProtoState memory state) external;

    function state() external view returns (ProtoState memory);

    // COMMANDS

    function CMD_issue(Account account, uint256 amount) external;

    function CMD_redeem(Account account, uint256 amount) external;

    function CMD_checkForDefault(Account account) external;

    function CMD_poke(Account account) external;

    //
    // function setOraclePrices(CollateralToken[] memory tokens, Fix[] memory prices) external;

    // function setDefiRates(
    //     DefiProtocol protocol,
    //     CollateralToken[] memory tokens,
    //     Fix[] memory redemptionRates
    // ) external;

    // INVARIANTS
    function INVARIANT_isFullyCapitalized() external view returns (bool);
    // ...more
}
