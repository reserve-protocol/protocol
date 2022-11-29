// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IFacadeRead.sol";

abstract contract ZapLogicBase {
    using SafeERC20 for IERC20;

    address internal constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address internal constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
    address internal constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;

    function isStablecoin(address _inputToken) internal pure returns (bool) {
        return _inputToken == USDC || _inputToken == DAI || _inputToken == USDT;
    }

    /// Zap an arbitrary token to target collateral token
    /// @param _inputToken The token to buy with
    /// @param _inputAmount The amount of _inputToken to buy with
    /// @return tokensPurchased The underlying assets

    function zapToCollateral(address _inputToken, uint256 _inputAmount)
        public
        virtual
        returns (uint256 tokensPurchased);
}
