// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IRToken.sol";

/**
 * @title IFacadeMonitor
 * @notice A monitoring layer for RTokens
 */

/// PluginType
enum CollPluginType {
    AAVE_V2,
    AAVE_V3,
    COMPOUND_V2,
    COMPOUND_V3,
    STARGATE,
    FLUX,
    MORPHO_AAVE_V2
}

/**
 * @title MonitorParams
 * @notice The set of protocol params needed for the required calculations
 * Should be defined at deployment based on network
 */

// solhint-disable var-name-mixedcase
struct MonitorParams {
    // === AAVE_V2===
    address AAVE_V2_DATA_PROVIDER_ADDR;
}

interface IFacadeMonitor {
    // === Views ===
    function batchAuctionsDisabled(IRToken rToken) external view returns (bool);

    function dutchAuctionsDisabled(IRToken rToken) external view returns (bool);

    function issuanceAvailable(IRToken rToken) external view returns (uint256);

    function redemptionAvailable(IRToken rToken) external view returns (uint256);

    function backingReedemable(
        IRToken rToken,
        CollPluginType collType,
        IERC20 erc20
    ) external view returns (uint256);
}
