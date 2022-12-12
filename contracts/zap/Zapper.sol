// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { RTokenP1 } from "contracts/p1/RToken.sol";
import { IRToken } from "contracts/interfaces/IRToken.sol";
import { IBasketHandler } from "contracts/interfaces/IBasketHandler.sol";
import { IMain } from "contracts/interfaces/IMain.sol";
import { IFacadeRead } from "contracts/interfaces/IFacadeRead.sol";

import { IZap } from "./interfaces/IZap.sol";
import { IZapRouter } from "./ZapRouter.sol";

/**
 * @title Zapper
 * @notice The Zapper serve as the entry point for users to effortlessly
 * swap into and out of positions in the Reserve ecosystem.
 * Swap requests are routed to the ZapRouter for execution.
 */
contract Zapper is IZap {
    using SafeERC20 for IERC20;

    IFacadeRead private immutable facade = IFacadeRead(0x3DAf5a7681a9cfB92fB38983EB3998dFC7963B28);
    IZapRouter public zapRouter;
    address public zapManager;

    /// @param _zapRouter The default zap router to utilize
    constructor(address _zapRouter) {
        zapRouter = IZapRouter(_zapRouter);
        zapManager = msg.sender;
    }

    /// @param _zapManager New zap manager
    function setZapManager(address _zapManager) external {
        require(msg.sender == zapManager, "!manager");
        zapManager = _zapManager;
    }

    /// @param _zapRouter New zap router
    function setZapRouter(address _zapRouter) external {
        require(msg.sender == zapManager, "!manager");
        zapRouter = IZapRouter(_zapRouter);
    }

    function zapIn(
        address _from,
        address _to,
        uint256 _amount
    ) external returns (uint256 received) {
        IERC20(_from).safeTransferFrom(msg.sender, address(this), _amount);

        (address[] memory erc20s, uint256[] memory zappedAmounts) = zapToCollateralTokens(
            _from,
            _to,
            _amount
        );

        uint256 lowestIssueRatio = getLowestIssueRatio(IRToken(_to), zappedAmounts);
        IRToken(_to).issue((lowestIssueRatio * 9950) / 10_000);

        received = IERC20(_to).balanceOf(address(this));
        IERC20(address(_to)).safeTransfer(msg.sender, received);

        // Refund unused amounts
        for (uint256 i = 0; i < erc20s.length; i++) {
            uint256 refundAmount = IERC20(erc20s[i]).balanceOf(address(this));
            if (refundAmount > 0) {
                IERC20(erc20s[i]).safeTransfer(msg.sender, refundAmount);
            }
        }
    }

    function zapOut(
        address _from,
        address _to,
        uint256 _amount
    ) external returns (uint256 received) {
        IERC20(_from).safeTransferFrom(msg.sender, address(this), _amount);

        IRToken(_from).redeem(_amount);
        (address[] memory erc20s, , ) = facade.basketBreakdown(RTokenP1(address(_from)));

        for (uint256 i = 0; i < erc20s.length; i++) {
            address token = erc20s[i];
            if (token == _to) {
                continue;
            }
            uint256 swapAmount = IERC20(token).balanceOf(address(this));
            IERC20(token).safeApprove(address(zapRouter), 0);
            IERC20(token).safeApprove(address(zapRouter), swapAmount);
            zapRouter.swap(token, _to, swapAmount);
        }

        received = IERC20(_to).balanceOf(address(this));
        IERC20(_to).safeTransfer(msg.sender, received);
    }

    /// @notice Zap input token to individual rToken assets
    /// @param _from Token to zap out from into rToken
    /// @param _to rToken to zap out into
    /// @param _amount Amount of token _from to zap in
    /// @return addresses Addresses of tokens acquired
    /// @return amoutns Amounts of tokens returned
    function zapToCollateralTokens(
        address _from,
        address _to,
        uint256 _amount
    ) internal returns (address[] memory, uint256[] memory) {
        // Acquire breakdown of basket assets
        (address[] memory erc20s, uint192[] memory uoaShares, ) = facade.basketBreakdown(
            RTokenP1(address(_to))
        );

        uint256[] memory amounts = new uint256[](erc20s.length);

        // Verify a valid configuration
        uint256 totalSharesDenom;
        for (uint256 i = 0; i < erc20s.length; i++) {
            totalSharesDenom += uoaShares[i];
        }

        // TODO: LARRY ITS NOT ALWAYS 1
        // require(totalSharesDenom == 1 ether, "!totalSharesDenom");

        // Loop through each underlying asset and zap into each
        for (uint256 i = 0; i < erc20s.length; i++) {
            address erc20 = erc20s[i];
            uint256 uoaShare = uoaShares[i];

            // Zap
            uint256 zapAmount = (_amount * uoaShare) / totalSharesDenom;
            IERC20(_from).safeApprove(address(zapRouter), 0);
            IERC20(_from).safeApprove(address(zapRouter), zapAmount);
            uint256 erc20Amount = zapRouter.swap(_from, erc20, zapAmount);
            amounts[i] = erc20Amount;

            // Approve rToken spending
            IERC20(erc20).safeApprove(address(_to), 0);
            IERC20(erc20).safeApprove(address(_to), erc20Amount);
        }

        return (erc20s, amounts);
    }

    /// @notice Get the lowest ratio of collateral asset to determine issue amount
    /// @param _rToken Address of the rToken to verify against
    /// @param _zappedAmounts Amounts of tokens available to issue rToken
    function getLowestIssueRatio(IRToken _rToken, uint256[] memory _zappedAmounts)
        internal
        view
        returns (uint256 lowestRatio)
    {
        IMain main = IMain(_rToken.main());
        IBasketHandler basketHandler = IBasketHandler(main.basketHandler());

        // Get amtBaskets for 1e18 rToken to use as reference
        // See RToken.sol:218
        uint192 amtBaskets = uint192(
            _rToken.totalSupply() > 0
                ? mulDiv256(_rToken.basketsNeeded(), 1 ether, _rToken.totalSupply())
                : 1 ether
        );

        (address[] memory erc20s, uint256[] memory quantities) = basketHandler.quote(
            amtBaskets,
            CEIL
        );

        for (uint256 i = 0; i < erc20s.length; i++) {
            uint256 ratio = (_zappedAmounts[i] * FIX_SCALE) / quantities[i];
            if (ratio < lowestRatio || lowestRatio == 0) {
                lowestRatio = ratio;
            }
        }
    }
}
