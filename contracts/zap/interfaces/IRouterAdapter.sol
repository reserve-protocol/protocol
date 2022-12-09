// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface IRouterAdapter {

    /// @return supportedTokens List of tokens the adapter supports hooks for
    function supportedTokens() external view returns (address[] memory);

    /// @param _token The token to check if adapter has support for 
    /// @return isAdapterToken true if adapter supports token, false if not
    function isAdapterToken(address _token) external view returns (bool);

    /// @param _token Target supported token to retrieve underlying asset
    /// @return unwrapToken The token that target token unwraps to
    function getUnwrapToken(address _token) external view returns (address);

    /// @param _token Token to wrap into
    /// @param _amount Amount of underlying token to utilize for wrapping
    /// @return received Amount of _token returned
    function wrap(address _token, uint256 _amount) external returns (uint256 received);

    /// @param _token Token to unwrap from
    /// @param _amount Amount of _token to unwrap
    /// @return unwrapToken The token returned from unwrapping
    /// @return received The amount of unwrap token returned
    function unwrap(address _token, uint256 _amount)
        external
        returns (address unwrapToken, uint256 received);
}
