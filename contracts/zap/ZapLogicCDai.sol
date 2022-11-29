// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/zap/ZapLogicBase.sol";
import "contracts/zap/interfaces/ICurve.sol";
import "contracts/zap/interfaces/ICToken.sol";

contract ZapLogicCDai is ZapLogicBase {
    using SafeERC20 for IERC20;

    address private constant CURVE_THREE_POOL = 0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7;
    address private constant CDAI = 0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643;

    function zapToCollateral(address _inputToken, uint256 _inputAmount)
        public
        override
        returns (uint256 tokensPurchased)
    {
        IERC20(_inputToken).safeTransferFrom(msg.sender, address(this), _inputAmount);

        require(IERC20(_inputToken).balanceOf(address(this)) == _inputAmount, "!balance");

        if (_inputToken == DAI) {
            tokensPurchased = depositToCompound(_inputAmount);
        }

        // Swap on Curve 3pool
        if (isStablecoin(_inputToken)) {
            IERC20(_inputToken).safeApprove(CURVE_THREE_POOL, 0);
            IERC20(_inputToken).safeApprove(CURVE_THREE_POOL, _inputAmount);

            ICurve(CURVE_THREE_POOL).exchange(
                _inputToken == USDC ? int128(1) : int128(2),
                0, // DAI is index 0 on 3pool
                _inputAmount,
                0
            );

            tokensPurchased = depositToCompound(IERC20(DAI).balanceOf(address(this)));
        }

        if (tokensPurchased > 0) IERC20(CDAI).safeTransfer(msg.sender, tokensPurchased);

        /// TODO - add support for other tokens
    }

    /// Internal function for depositing DAI on Compound
    function depositToCompound(uint256 _inputAmount) internal returns (uint256) {
        IERC20(DAI).safeApprove(CDAI, 0);
        IERC20(DAI).safeApprove(CDAI, _inputAmount);
        require(ICToken(CDAI).mint(_inputAmount) == 0, "!deposit");

        return IERC20(CDAI).balanceOf(address(this));
    }
}
