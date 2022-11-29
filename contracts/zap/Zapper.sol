// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/zap/ZapLogicBase.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p1/RToken.sol";

import "contracts/interfaces/IRToken.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IFacadeRead.sol";

interface IRtokenP1 is IRToken {
    function mint(address _account, uint256 _amount) external;
}

contract Zapper {
    using SafeERC20 for IERC20;

    IFacadeRead private facade = IFacadeRead(0x3DAf5a7681a9cfB92fB38983EB3998dFC7963B28);

    mapping(address => address) public zapLogic; // erc20 => zapLogicContract

    /// Zap an arbitrary token to target collateral tokens
    function zapIn(
        IRToken _rtoken,
        address _inputToken,
        uint256 _inputAmount
    ) external {
        IERC20(_inputToken).safeTransferFrom(msg.sender, address(this), _inputAmount);

        zapToCollateralTokens(_rtoken, _inputToken, _inputAmount);

        uint256 lowestIssueRatio = getLowestIssueRatio(_rtoken);

        // TODO THIS SEEMS WRONG
        // Account for rounding errors
        _rtoken.issue((lowestIssueRatio * 9999) / 10000);

        IERC20(address(_rtoken)).safeTransfer(msg.sender, _rtoken.balanceOf(address(this)));
    }

    /// TODO place access control on this
    function registerZapLogic(address[] calldata _erc20s, address[] calldata _zapLogicContract)
        external
    {
        require(_erc20s.length == _zapLogicContract.length, "Zapper: invalid length");
        for (uint256 i = 0; i < _erc20s.length; i++) {
            zapLogic[_erc20s[i]] = _zapLogicContract[i];
        }
    }

    function zapToCollateralTokens(
        IRToken _rtoken,
        address _inputToken,
        uint256 _inputAmount
    ) internal {
        // Get underlying assets and ratios
        // TODO this is a write call - check if it's safe
        (address[] memory erc20s, uint192[] memory uoaShares, ) = facade.basketBreakdown(
            RTokenP1(address(_rtoken))
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

            // Get zap logic
            address zapLogicContract = zapLogic[erc20];

            // TODO handle case for no zap logic
            if (zapLogicContract == address(0)) {
                continue;
            }

            // Zap
            uint256 zapAmount = (_inputAmount * uoaShare) / totalSharesDenom;

            IERC20(_inputToken).safeApprove(zapLogicContract, 0);
            IERC20(_inputToken).safeApprove(zapLogicContract, zapAmount);

            // TODO create interface files
            uint256 erc20Amount = ZapLogicBase(zapLogicContract).zapToCollateral(
                _inputToken,
                zapAmount
            );

            // Approve rToken spending
            IERC20(erc20).safeApprove(address(_rtoken), 0);
            IERC20(erc20).safeApprove(address(_rtoken), erc20Amount);
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
            if (ratio < lowestRatio || lowestRatio == 0) lowestRatio = ratio;
        }
    }
}
