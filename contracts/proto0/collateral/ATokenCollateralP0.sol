// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./CollateralP0.sol";

// https://github.com/aave/protocol-v2/blob/feat-atoken-wrapper-liquidity-mining/contracts/protocol/tokenization/StaticATokenLM.sol
interface IStaticAToken {
    function rate() external view returns (uint256);

    function ATOKEN() external view returns (AToken);
}

interface AToken {
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
}

contract ATokenCollateralP0 is CollateralP0 {
    // All aTokens have 18 decimals.
    constructor(address erc20_) CollateralP0(erc20_) {}

    function redemptionRate() external view override returns (uint256) {
        return IStaticAToken(_erc20).rate() * 10**(18 - fiatcoinDecimals());
    }

    function fiatcoin() public view override returns (address) {
        return IStaticAToken(_erc20).ATOKEN().UNDERLYING_ASSET_ADDRESS();
    }

    function isFiatcoin() external pure override returns (bool) {
        return false;
    }
}
