// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { IStaticAToken } from "./interfaces/IStaticAToken.sol";
import { IRouterAdapter } from "./interfaces/IRouterAdapter.sol";

contract StaticAaveRouterAdapter is IRouterAdapter {
    using SafeERC20 for IERC20;

    mapping(address => bool) public isStaticAaveToken;
    address[] public getSupportedToken;

    constructor(address[] memory _supportedTokens) {
        for (uint256 i = 0; i < _supportedTokens.length; i++) {
            isStaticAaveToken[_supportedTokens[i]] = true;
            getSupportedToken.push(_supportedTokens[i]);
        }
    }

    function supportedTokens() external view returns (address[] memory) {
        return getSupportedToken;
    }

    function isAdapterToken(address _token) external view returns (bool) {
        return isStaticAaveToken[_token];
    }

    function getUnwrapToken(address _token) external view returns (address) {
        return IStaticAToken(_token).ASSET();
    }

    function wrap(address _token, uint256 _amount) external returns (uint256 received) {
        address unwrapToken = this.getUnwrapToken(_token);
        IERC20(unwrapToken).safeTransferFrom(msg.sender, address(this), _amount);
        require(IERC20(unwrapToken).balanceOf(address(this)) == _amount, "!balance");

        IERC20(unwrapToken).safeApprove(_token, 0);
        IERC20(unwrapToken).safeApprove(_token, _amount);
        return IStaticAToken(_token).deposit(msg.sender, _amount, 0x0, true);
    }

    function unwrap(address _token, uint256 _amount)
        external
        returns (address unwrapToken, uint256 received)
    {
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        require(IERC20(_token).balanceOf(address(this)) == _amount, "!balance");

        unwrapToken = this.getUnwrapToken(_token);
        IERC20(_token).safeApprove(_token, 0);
        IERC20(_token).safeApprove(_token, _amount);
        (, received) = IStaticAToken(_token).withdraw(msg.sender, _amount, true);
    }
}
