// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface IRouterAdapter {
    function supportedTokens() external view returns (address[] memory);
    
    function isAdapterToken(address _token) external view returns (bool);

    function getUnwrapToken(address _token) external view returns (address);

    function wrap(address _token, uint256 _amount) external returns (uint256 received);

    function unwrap(address _token, uint256 _amount) external returns (address unwrapToken, uint256 received);
}
