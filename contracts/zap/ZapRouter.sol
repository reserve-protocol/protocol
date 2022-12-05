// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import { IAddressProvider } from "./interfaces/IAddressProvider.sol";
import { ICurveExchange, ICurvePool } from "./interfaces/ICurveExchange.sol";
import { IComptroller } from "./interfaces/IComptroller.sol";
import { ICToken } from "./interfaces/ICToken.sol";
import { IZapRouter } from "./interfaces/IZapRouter.sol";
import { ICurveRegistry } from "./interfaces/ICurveRegistry.sol";

import "hardhat/console.sol";

contract ZapRouter is IZapRouter {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_BPS = 10_000;
    address public constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;

    IAddressProvider internal constant CURVE_ADDRESS_PROVIDER =
        IAddressProvider(0x0000000022D53366457F9d5E68Ec105046FC4383);
    ICurveExchange internal curveExchangeProvider;
    ICurveRegistry internal curveRegistry;

    uint256 public maxSlippage;

    mapping(address => bool) public isCompoundToken;

    constructor(uint256 _maxSlippage) {
        IComptroller comptroller = IComptroller(0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B);
        address[] memory markets = comptroller.getAllMarkets();
        for (uint256 i = 0; i < markets.length; i++) {
            isCompoundToken[markets[i]] = true;
        }

        curveExchangeProvider = ICurveExchange(CURVE_ADDRESS_PROVIDER.get_address(2));
        curveRegistry = ICurveRegistry(CURVE_ADDRESS_PROVIDER.get_registry());

        maxSlippage = _maxSlippage;
        require(maxSlippage < MAX_BPS, "Invalid slippage");
    }

    function swap(
        address _from,
        address _to,
        uint256 _amount
    ) external returns (uint256 received) {
        IERC20(_from).safeTransferFrom(msg.sender, address(this), _amount);
        require(IERC20(_from).balanceOf(address(this)) == _amount, "!balance");

        address source = _from;
        address target = _to;
        uint256 amount = _amount;

        if (isCompoundToken[_to]) {
            target = ICToken(_to).underlying();
        }
        if (isCompoundToken[_from]) {
            IERC20(_from).safeApprove(_from, 0);
            IERC20(_from).safeApprove(_from, amount);
            require(ICToken(_from).redeem(amount) == 0, "!redeem");
            source = ICToken(_from).underlying();
            amount = IERC20(source).balanceOf(address(this));
        }

        if (source == target) {
            received = IERC20(source).balanceOf(address(this));
        } else {
            /// @notice Only supports stable coin swap look ups, need to investigate how to query for tricrypto based routing
            (address exchangePool, uint256 exchangeAmount) = curveExchangeProvider.get_best_rate(
                source,
                target,
                amount
            );

            IERC20(source).safeApprove(address(curveExchangeProvider), 0);
            IERC20(source).safeApprove(address(curveExchangeProvider), amount);

            // swapRoute takes the form [token0, poolx, token1, pooly, token2, ...]
            address[9] memory swapRoute;

            swapRoute[0] = source;

            // swapParams is a Multidimensional array of [i, j, swap type]
            // where i and j are the to/from token indices of the pool
            uint256[3][4] memory swapParams;

            // Multi-hop swap with USDT required
            if (exchangePool == address(0)) {
                // Step 1: define swapRoute
                (address exchangePoolHopOne, uint256 exchangeAmountHopOne) = curveExchangeProvider
                    .get_best_rate(source, USDT, amount);
                swapRoute[1] = exchangePoolHopOne;
                swapRoute[2] = USDT;

                (address exchangePoolHopTwo, uint256 exchangeAmountHopTwo) = curveExchangeProvider
                    .get_best_rate(USDT, target, exchangeAmountHopOne);

                swapRoute[3] = exchangePoolHopTwo;
                swapRoute[4] = target;

                // Step 2: define swapParams, first for hop one, then for hop two
                // can attempt curveRegistry.get_coin_indices() to get the indices
                // but not always congruent with recommended pool from get_best_rate
                swapParams[0] = buildSwapParams(exchangePoolHopOne, source, USDT);
                swapParams[0][2] = 3; // tricrypto swap type

                swapParams[1] = buildSwapParams(exchangePoolHopTwo, USDT, target);
                swapParams[1][2] = 1; // stable swap type

                received = curveExchangeProvider.exchange_multiple(
                    swapRoute,
                    swapParams,
                    amount,
                    exchangeAmountHopTwo - ((exchangeAmountHopTwo * maxSlippage) / MAX_BPS)
                );
            } else {
                // Single hop swap, use initial pool/quote
                received = curveExchangeProvider.exchange(
                    exchangePool,
                    source,
                    target,
                    amount,
                    exchangeAmount - ((exchangeAmount * maxSlippage) / MAX_BPS),
                    address(this)
                );
            }
        }

        if (isCompoundToken[_to]) {
            IERC20(target).safeApprove(_to, 0);
            IERC20(target).safeApprove(_to, received);
            require(ICToken(_to).mint(received) == 0, "!deposit");
            received = IERC20(_to).balanceOf(address(this));
        }

        IERC20(_to).safeTransfer(msg.sender, received);
    }

    function buildSwapParams(
        address _pool,
        address _from,
        address _to
    ) private view returns (uint256[3] memory) {
        uint256[3] memory swapParams;
        bool foundIdx0;
        bool foundIdx1;
        for (uint256 i = 0; i <= 4; i++) {
            if (foundIdx0 && foundIdx1) break;

            address coinAtIdx = ICurvePool(_pool).coins(i);
            if (coinAtIdx == _from) {
                swapParams[0] = i;
                foundIdx0 = true;
            }
            if (coinAtIdx == _to) {
                swapParams[1] = i;
                foundIdx1 = true;
            }
        }

        return swapParams;
    }
}
