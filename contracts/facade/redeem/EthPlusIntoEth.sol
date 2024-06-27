// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import { IRToken } from "../../interfaces/IRToken.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626 } from "@openzeppelin/contracts/interfaces/IERC4626.sol";

interface IRETHRouter {
    function swapTo(
        uint256 _uniswapPortion,
        uint256 _balancerPortion,
        uint256 _minTokensOut,
        uint256 _idealTokensOut
    ) external payable;

    function swapFrom(
        uint256 _uniswapPortion,
        uint256 _balancerPortion,
        uint256 _minTokensOut,
        uint256 _idealTokensOut,
        uint256 _tokensIn
    ) external;

    function optimiseSwapTo(uint256 _amount, uint256 _steps)
        external
        returns (uint256[2] memory portions, uint256 amountOut);

    function optimiseSwapFrom(uint256 _amount, uint256 _steps)
        external
        returns (uint256[2] memory portions, uint256 amountOut);
}

interface IWSTETH is IERC20 {
    function unwrap(uint256 _wstETHAmount) external returns (uint256);
}

interface IUniswapV2Like {
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        // is ignored, but can be empty
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);
}

interface ICurveETHstETHStableSwap {
    function exchange(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 minDy
    ) external payable returns (uint256);
}

interface ICurveStableSwap {
    function exchange(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 minDy,
        address receiver
    ) external returns (uint256);
}

contract EthPlusIntoEth is IUniswapV2Like {
    using SafeERC20 for IERC20;

    IRToken private constant ETH_PLUS = IRToken(0xE72B141DF173b999AE7c1aDcbF60Cc9833Ce56a8);

    IERC20 private constant RETH = IERC20(0xae78736Cd615f374D3085123A210448E74Fc6393);
    IRETHRouter private constant RETH_ROUTER =
        IRETHRouter(0x16D5A408e807db8eF7c578279BEeEe6b228f1c1C);

    IWSTETH private constant WSTETH = IWSTETH(0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0);
    IERC20 private constant STETH = IERC20(0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84);

    IERC4626 private constant SFRXETH = IERC4626(0xac3E018457B222d93114458476f3E3416Abbe38F);
    IERc20 private constant FRXETH = IERc20(0x5E8422345238F34275888049021821E8E08CAa1f);
    ICurveETHstETHStableSwap private constant CURVE_ETHSTETH_STABLE_SWAP =
        ICurveETHstETHStableSwap(0xDC24316b9AE028F1497c275EB9192a3Ea0f67022);
    ICurveStableSwap private constant CURVE_FRXETH_WETH =
        ICurveStableSwap(0x9c3B46C0Ceb5B9e304FCd6D88Fc50f7DD24B31Bc);

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        // is ignored, but can be empty
        // solhint-disable-next-line unused-ignore
        address[] calldata,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(deadline >= block.timestamp, "deadline");
        ETH_PLUS.transferFrom(msg.sender, address(this), amountIn);
        ETH_PLUS.redeem(ETH_PLUS.balanceOf(address(this)));

        // reth -> eth
        {
            uint256 rethBalance = RETH.balanceOf(address(this));
            (uint256[2] memory portions, uint256 expectedETHOut) = RETH_ROUTER.optimiseSwapFrom(
                rethBalance,
                2
            );
            RETH.approve(address(rethRouter), rethBalance);
            RETH_ROUTER.swapFrom(
                portions[0],
                portions[1],
                expectedETHOut,
                expectedETHOut,
                rethBalance
            );
        }

        // wsteth -> eth
        {
            WSTETH.unwrap(WSTETH.balanceOf(address(this)));
            uint256 stethBalance = STETH.balanceOf(address(this));
            STETH.approve(address(CURVE_ETHSTETH_STABLE_SWAP), stethBalance);
            CURVE_ETHSTETH_STABLE_SWAP.exchange(1, 0, sfrxethBalance, 0);
        }

        // sfrxeth -> eth
        {
            uint256 sfrxethBalance = SFRXETH.balanceOf(address(this));
            SFRXETH.redeem(sfrxethBalance, address(this), address(this));
            uint256 frxethBalance = FRXETH.balanceOf(address(this));
            FRXETH.approve(address(CURVE_FRXETH_WETH), frxethBalance);

            // frxeth -> weth
            CURVE_FRXETH_WETH.exchange(1, 0, frxethBalance, 0);

            // weth -> eth
            WETH.withdraw(WETH.balanceOf(address(this)));
        }

        // solhint-disable-next-line custom-errors
        require(this.balance >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");
        this.transfer(to, this.balance);
    }

    receive() external payable {}
}
