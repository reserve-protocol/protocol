// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/zap/ZapLogicBase.sol";
import "contracts/zap/interfaces/ICurve.sol";

contract ZapLogicDai is ZapLogicBase {
    using SafeERC20 for IERC20;

    address private constant CURVE_THREE_POOL = 0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7;

    function zapToCollateral(address _inputToken, uint256 _inputAmount)
        public
        override
        returns (uint256 tokensPurchased)
    {
        IERC20(_inputToken).safeTransferFrom(msg.sender, address(this), _inputAmount);

        require(IERC20(_inputToken).balanceOf(address(this)) == _inputAmount, "!balance");

        if (_inputToken == DAI) {
            tokensPurchased = _inputAmount;
        }

        // Swap on Curve 3pool
        if (isStablecoin(_inputToken)) {
            IERC20(_inputToken).approve(CURVE_THREE_POOL, 0);
            IERC20(_inputToken).approve(CURVE_THREE_POOL, _inputAmount);

            ICurve(CURVE_THREE_POOL).exchange(
                _inputToken == USDC ? int128(1) : int128(2),
                0, // DAI is index 0 on 3pool
                _inputAmount,
                0
            );
            tokensPurchased = IERC20(DAI).balanceOf(address(this));
        }

        if (tokensPurchased > 0) IERC20(DAI).safeTransfer(msg.sender, tokensPurchased);

        /// TODO - add support for other tokens
    }
}
