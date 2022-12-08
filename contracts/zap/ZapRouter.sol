// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import { IAddressProvider } from "./interfaces/IAddressProvider.sol";
import { ICurveExchange, ICurvePool } from "./interfaces/ICurveExchange.sol";
import { IZapRouter } from "./interfaces/IZapRouter.sol";
import { ICurveRegistry } from "./interfaces/ICurveRegistry.sol";
import { IRouterAdapter } from "./interfaces/IRouterAdapter.sol";

contract ZapRouter is IZapRouter {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_BPS = 10_000;
    address public constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;

    IAddressProvider internal constant CURVE_ADDRESS_PROVIDER =
        IAddressProvider(0x0000000022D53366457F9d5E68Ec105046FC4383);
    ICurveExchange internal curveExchangeProvider;
    ICurveRegistry internal curveRegistry;

    mapping(address => address) public getRouterAdapter;
    uint256 public maxSlippage;
    address public routerManager;

    constructor(uint256 _maxSlippage) {
        curveExchangeProvider = ICurveExchange(CURVE_ADDRESS_PROVIDER.get_address(2));
        curveRegistry = ICurveRegistry(CURVE_ADDRESS_PROVIDER.get_registry());

        maxSlippage = _maxSlippage;
        require(maxSlippage < MAX_BPS, "Invalid slippage");
        routerManager = msg.sender;
    }

    function setRouterManager(address _routerManager) public {
        require(msg.sender == routerManager, "!manager");
        routerManager = _routerManager;
    }

    /// @notice This overrides existing registrations, adapaters are limited 1:1
    function registerAdapter(address _adapter) public {
        require(msg.sender == routerManager, "!manager");
        address[] memory supportedTokens = IRouterAdapter(_adapter).supportedTokens();
        for (uint256 i = 0; i < supportedTokens.length; i++) {
            getRouterAdapter[supportedTokens[i]] = _adapter;
        }
    }

    /// @param _routerManager Address to set as new router manager
    function setRouterManager(address _routerManager) public {
        require(msg.sender == routerManager, "!manager");
        routerManager = _routerManager;
    }

    /// @param _adapter Address to register a new adapter at
    /// @dev This overrides existing registrations, adapaters are limited 1:1
    function registerAdapter(address _adapter) public {
        require(msg.sender == routerManager, "!manager");
        address[] memory supportedTokens = IRouterAdapter(_adapter).supportedTokens();
        for (uint256 i = 0; i < supportedTokens.length; i++) {
            getRouterAdapter[supportedTokens[i]] = _adapter;
        }
    }

    /// @param _from Token to swap into the zap
    /// @param _to Token to swap out of the zap
    /// @param _amount Amount of _from to input into the zap
    /// @dev Swap is zap in / out agnostic and works bidirectionally
    function swap(
        address _from,
        address _to,
        uint256 _amount
    ) external returns (uint256 received) {
        IERC20(_from).safeTransferFrom(msg.sender, address(this), _amount);
        require(IERC20(_from).balanceOf(address(this)) == _amount, "!balance");

        // Grab possible token adapters, these are not required
        IRouterAdapter fromAdapter = IRouterAdapter(getRouterAdapter[_from]);
        IRouterAdapter toAdapter = IRouterAdapter(getRouterAdapter[_to]);

        // Update the source, target, and amounts depending on adapater actions
        // Adapters may unwrap a token potentially changing the amount that needs to be swapped
        address source = _from;
        address target = _to;
        uint256 amount = _amount;

        if (address(toAdapter) != address(0) && toAdapter.isAdapterToken(_to)) {
            target = toAdapter.getUnwrapToken(_to);
        }
        if (address(fromAdapter) != address(0) && fromAdapter.isAdapterToken(_from)) {
            IERC20(_from).safeApprove(address(fromAdapter), 0);
            IERC20(_from).safeApprove(address(fromAdapter), _amount);
            (source, amount) = fromAdapter.unwrap(_from, _amount);
        }

        if (source == target) {
            received = IERC20(target).balanceOf(address(this));
        } else {
            /// @notice Only supports stable coin swap look ups,
            /// need to investigate how to query for tricrypto based routing
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

                swapParams[1] = buildSwapParams(exchangePoolHopTwo, USDT, target);

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

        if (address(toAdapter) != address(0) && toAdapter.isAdapterToken(_to)) {
            address unwrapToken = toAdapter.getUnwrapToken(_to);
            IERC20(unwrapToken).safeApprove(address(toAdapter), 0);
            IERC20(unwrapToken).safeApprove(address(toAdapter), received);
            received = toAdapter.wrap(_to, received);
        }

        IERC20(_to).safeTransfer(msg.sender, received);
    }

    function buildSwapParams(
        address _pool,
        address _from,
        address _to
    ) private view returns (uint256[3] memory) {
        uint256[3] memory swapParams;

        try curveRegistry.get_coin_indices(_pool, _from, _to) returns (
            int256 fromIdx,
            int256 toIdx,
            bool isUnderlying
        ) {
            swapParams[0] = uint256(fromIdx);
            swapParams[1] = uint256(toIdx);

            swapParams[2] = isUnderlying ? 2 : 1;
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string

            bool foundIdx0;
            bool foundIdx1;
            for (uint256 i = 0; i < 4; i++) {
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

            swapParams[2] = 3; // tricrypto swap type
        }

        return swapParams;
    }
}
