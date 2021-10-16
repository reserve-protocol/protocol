// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./Collateral.sol";

// https://github.com/aave/protocol-v2/blob/feat-atoken-wrapper-liquidity-mining/contracts/protocol/tokenization/StaticATokenLM.sol
interface IStaticAToken {
    function rate() external view returns (uint256);
}

contract ATokenCollateral is Collateral {

    constructor(address erc20_, uint256 quantity_, uint8 decimals) Collateral(erc20_, quantity_, decimals) {}

    function getRedemptionRate() external override returns (uint256) {
        return IStaticAToken(_erc20).rate();
    }
}
