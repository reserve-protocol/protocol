// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "./AbstractMarket.sol";

// This interface is redundant with the one from contracts/plugins/aave/IStaticAToken,
// but it's compiled with a different solidity version.
interface IStaticAToken is IERC20Metadata {
    /**
     * @notice Claim rewards
     * @param forceUpdate Flag to retrieve latest rewards from `INCENTIVES_CONTROLLER`
     */
    function claimRewardsToSelf(bool forceUpdate) external;

    /**
     * @notice Returns the Aave liquidity index of the underlying aToken, denominated rate here
     * as it can be considered as an ever-increasing exchange rate
     * @return The liquidity index
     **/
    function rate() external view returns (uint256);

    /// @return The reward token, ie stkAAVE
    // solhint-disable-next-line func-name-mixedcase
    function REWARD_TOKEN() external view returns (IERC20);
}

contract ATokenMarket is AbstractMarket {
    function enter(MarketCall calldata call)
        external
        payable
        virtual
        override
        returns (uint256 amountOut)
    {
        // require(call.amountIn != 0, "ATokenMarket: INSUFFICIENT_INPUT");
        // IAToken aToken = IAToken(address(call.toToken));
        // uint256 initialBalance = aToken.balanceOf(address(this));
        // if (address(call.fromToken) == address(0)) {
        //     aToken.mint{ value: call.amountIn }();
        // } else {
        //     call.fromToken.approve(address(aToken), call.amountIn);
        //     aToken.mint(call.amountIn);
        // }
        // amountOut = aToken.balanceOf(address(this)) - initialBalance;
        // require(amountOut >= call.minAmountOut, "ATokenMarket: INSUFFICIENT_OUTPUT");
    }

    function exit(MarketCall calldata call)
        external
        payable
        virtual
        override
        returns (uint256 amountOut)
    {
        // require(msg.value == 0, "ATokenMarket: INVALID_VALUE");
        // require(call.amountIn != 0, "ATokenMarket: INSUFFICIENT_INPUT");
        // IAToken aToken = IAToken(address(call.fromToken));
        // if (address(call.toToken) == address(0)) {
        //     uint256 initialBalance = address(this).balance;
        //     aToken.redeem(call.amountIn);
        //     amountOut = address(this).balance - initialBalance;
        // } else {
        //     uint256 initialBalance = call.toToken.balanceOf(address(this));
        //     aToken.redeem(call.amountIn);
        //     amountOut = call.toToken.balanceOf(address(this)) - initialBalance;
        // }
        // require(amountOut >= call.minAmountOut, "ATokenMarket: INSUFFICIENT_OUTPUT");
    }
}
