// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./IRelayERC20.sol";

interface ISlowMintingERC20 is IRelayERC20 {

    function startMinting(address account, uint256 amount) external;

    event MintingInitiated(address account, uint256 amount);
    event MintingComplete(address account, uint256 amount);
} 
