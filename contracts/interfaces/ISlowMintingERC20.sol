// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./IConfiguration.sol";
import "./IRelayERC20.sol";

interface ISlowMintingERC20 is IRelayERC20 {

    function conf() external returns(IConfiguration);
    function _startMinting(address account, uint256 amount) internal;

    event MintingInitiated(address account, uint256 amount);
    event MintingComplete(address account, uint256 amount);
} 
