// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../libraries/Config.sol";
import "../libraries/Token.sol";

interface IRTokenDeployer {
    event RTokenDeployed(address rToken);

    function deploy(
        address owner,
        string calldata name,
        string calldata symbol,
        Config memory rTokenConfig,
        Token.Info[] memory basketTokens,
        Token.Info memory rsrToken
    ) external returns (address);
}
