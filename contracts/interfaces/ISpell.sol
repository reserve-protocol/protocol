// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/governance/IGovernor.sol";
import "./IRToken.sol";

interface ISpell {
    // Cast once-per-sender
    /// @param rToken The RToken to upgrade
    /// @param governor The corresponding Governor Alexios for the RToken
    function cast(IRToken rToken, IGovernor governor) external;
}
