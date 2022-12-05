// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "contracts/p1/RToken.sol";

import "contracts/interfaces/IRToken.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IFacadeRead.sol";

import { IZap } from "./interfaces/IZap.sol";
import { IZapRouter } from "./ZapRouter.sol";

import "hardhat/console.sol";

interface IRtokenP1 is IRToken {
    function mint(address _account, uint256 _amount) external;
}

contract Zapper is IZap {
    using SafeERC20 for IERC20;

    IFacadeRead private immutable facade = IFacadeRead(0x3DAf5a7681a9cfB92fB38983EB3998dFC7963B28);
    IZapRouter public zapRouter;

    constructor(address _zapRouter) {
        zapRouter = IZapRouter(_zapRouter);
    }

    /// Zap an arbitrary token to target collateral tokens
    function zapIn(
        address _from,
        address _to,
        uint256 _amount
    ) external returns (uint256 received) {
        IERC20(_from).safeTransferFrom(msg.sender, address(this), _amount);

        zapToCollateralTokens(_from, _to, _amount);

        uint256 lowestIssueRatio = getLowestIssueRatio(IRToken(_to));
        // TOOD: this somehow fucks up and we can't mint, gives weird errors
        // console.log(lowestIssueRatio * 9950 / 10_000);
        IRToken(_to).issue(lowestIssueRatio * 9950 / 10_000);

        received = IERC20(_to).balanceOf(address(this));
        IERC20(address(_to)).safeTransfer(msg.sender, received);
    }

    function zapOut(
        address _from,
        address _to,
        uint256 _amount
    ) external returns (uint256 received) {
    }

    function zapToCollateralTokens(
        address _from,
        address _to,
        uint256 _amount
    ) internal {
        // Get underlying assets and ratios
        // TODO this is a write call - check if it's safe
        (address[] memory erc20s, uint192[] memory uoaShares, ) = facade.basketBreakdown(
            RTokenP1(address(_to))
        );

        // TODO SHOULD sum to 1e18 but have to verify
        uint256 totalSharesDenom;
        for (uint256 i = 0; i < erc20s.length; i++) {
            totalSharesDenom += uoaShares[i];
        }

        // Loop through each underlying asset and zap into each
        for (uint256 i = 0; i < erc20s.length; i++) {
            address erc20 = erc20s[i];
            uint256 uoaShare = uoaShares[i];

            // Zap
            uint256 zapAmount = (_amount * uoaShare) / totalSharesDenom;
            IERC20(_from).safeApprove(address(zapRouter), 0);
            IERC20(_from).safeApprove(address(zapRouter), zapAmount);
            uint256 erc20Amount = zapRouter.swap(_from, erc20, zapAmount);

            // Approve rToken spending
            IERC20(erc20).safeApprove(address(_to), 0);
            IERC20(erc20).safeApprove(address(_to), erc20Amount);
        }
    }

    /// Get the lowest ratio of collateral asset to determine issue amount
    function getLowestIssueRatio(IRToken _rtoken) internal view returns (uint256 lowestRatio) {
        IMain main = IMain(_rtoken.main());
        IBasketHandler basketHandler = IBasketHandler(main.basketHandler());

        // Get amtBaskets for 1e18 rToken to use as reference
        // See RToken.sol:218
        uint192 amtBaskets = uint192(
            _rtoken.totalSupply() > 0
                ? mulDiv256(_rtoken.basketsNeeded(), 1 ether, _rtoken.totalSupply())
                : 1 ether
        );

        (address[] memory erc20s, uint256[] memory quantities) = basketHandler.quote(
            amtBaskets,
            CEIL
        );

        for (uint256 i = 0; i < erc20s.length; i++) {
            uint256 ratio = (IERC20(erc20s[i]).balanceOf(address(this)) * FIX_SCALE) /
                quantities[i];
            if (ratio < lowestRatio || lowestRatio == 0) {
                lowestRatio = ratio;
            }
        }
    }
}
