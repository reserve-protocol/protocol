// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IAddressProvider } from "./interfaces/IAddressProvider.sol";
import { ICurveExchange } from "./interfaces/ICurveExchange.sol";
import { IComptroller } from "./interfaces/IComptroller.sol";
import { ICToken } from "./interfaces/ICToken.sol";
import { IZapRouter } from "./interfaces/IZapRouter.sol";

import "hardhat/console.sol";

contract ZapRouter is IZapRouter {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_BPS = 10_000;

    IAddressProvider internal constant curveAddressProvider = IAddressProvider(0x0000000022D53366457F9d5E68Ec105046FC4383);
    ICurveExchange internal curveExchangeProvider;

    address[] public supportedTokens;
    uint256 public maxSlippage;

    mapping(address => bool) public isSupportedToken;
    mapping(address => bool) public isCompoundToken;

    constructor(address[] memory _supportedTokens, uint256 _maxSlippage) {
        IComptroller comptroller = IComptroller(0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B);
        address[] memory markets = comptroller.getAllMarkets();
        for (uint256 i = 0; i < markets.length; i ++) {
            isCompoundToken[markets[i]] = true;
        }

        curveExchangeProvider = ICurveExchange(curveAddressProvider.get_address(2));

        supportedTokens = _supportedTokens;
        maxSlippage = _maxSlippage;
        require(maxSlippage < MAX_BPS, "Invalid slippage");

        for (uint256 i = 0; i < supportedTokens.length; i++) {
            isSupportedToken[supportedTokens[i]] = true;
        }
    }

    function swap(address _from, address _to, uint256 _amount) external returns (uint256 received) {
        IERC20(_from).safeTransferFrom(msg.sender, address(this), _amount);
        require(IERC20(_from).balanceOf(address(this)) == _amount, "!balance");

        address target = _to;
        uint256 amount = _amount;

        if (isCompoundToken[_to]) {
            target = ICToken(_to).underlying();
        }
        if (isCompoundToken[_from]) {
            require(ICToken(_to).redeem(_amount) == 0, "!redeem");
            amount = IERC20(_from).balanceOf(address(this));
        }

        (address exchangePool, uint256 exchangeAmount) = curveExchangeProvider.get_best_rate(_from, target, amount);
        uint256 expectedAmount = exchangeAmount - (exchangeAmount * maxSlippage / MAX_BPS);

        IERC20(_from).safeApprove(address(curveExchangeProvider), 0);
        IERC20(_from).safeApprove(address(curveExchangeProvider), amount);
        received = curveExchangeProvider.exchange(exchangePool, _from, target, amount, expectedAmount, address(this));

        if (isCompoundToken[_to]) {
            IERC20(target).safeApprove(_to, 0);
            IERC20(target).safeApprove(_to, received);
            require(ICToken(_to).mint(received) == 0, "!deposit");
            received = IERC20(_to).balanceOf(address(this));
        }

        console.log(_from, target, received, expectedAmount);
        IERC20(_to).safeTransfer(msg.sender, received);
    }
}
