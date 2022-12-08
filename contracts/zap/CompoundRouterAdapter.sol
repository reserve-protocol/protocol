// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IComptroller } from "./interfaces/IComptroller.sol";
import { ICToken } from "./interfaces/ICToken.sol";
import { IRouterAdapter } from "./interfaces/IRouterAdapter.sol";

import "hardhat/console.sol";

contract CompoundRouterAdapter is IRouterAdapter {
    using SafeERC20 for IERC20;

    mapping(address => bool) public isCompoundToken;
    address[] public getSupportedTokens;

    constructor() {
        IComptroller comptroller = IComptroller(0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B);
        address[] memory markets = comptroller.getAllMarkets();
        for (uint256 i = 0; i < markets.length; i++) {
            isCompoundToken[markets[i]] = true;
            getSupportedTokens.push(markets[i]);
        }
    }

    function supportedTokens() external view returns (address[] memory) {
        return getSupportedTokens;
    }

    function isAdapterToken(address _token) external view returns (bool) {
        return isCompoundToken[_token];
    }

    function getUnwrapToken(address _token) external view returns (address) {
        return ICToken(_token).underlying();
    }

    function wrap(address _token, uint256 _amount) external returns (uint256 received) {
        address unwrapToken = this.getUnwrapToken(_token);
        IERC20(unwrapToken).safeTransferFrom(msg.sender, address(this), _amount);
        require(IERC20(unwrapToken).balanceOf(address(this)) == _amount, "!balance");

        IERC20(unwrapToken).safeApprove(_token, 0);
        IERC20(unwrapToken).safeApprove(_token, _amount);
        require(ICToken(_token).mint(_amount) == 0, "!deposit");
        received = IERC20(_token).balanceOf(address(this));

        IERC20(_token).safeTransferFrom(address(this), msg.sender, received);
    }

    function unwrap(address _token, uint256 _amount) external returns (address unwrapToken, uint256 received) {
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        require(IERC20(_token).balanceOf(address(this)) == _amount, "!balance");

        unwrapToken = this.getUnwrapToken(_token);
        IERC20(_token).safeApprove(_token, 0);
        IERC20(_token).safeApprove(_token, _amount);
        require(ICToken(_token).redeem(_amount) == 0, "!redeem");
        received = IERC20(unwrapToken).balanceOf(address(this));

        IERC20(unwrapToken).safeTransfer(msg.sender, received);
    }

}
