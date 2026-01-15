// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// solhint-disable func-param-name-mixedcase, func-name-mixedcase
interface IAeroPool is IERC20Metadata {
    /// @notice Returns [token0, token1]
    function tokens() external view returns (address, address);

    /// @notice Address of token in the pool with the lower address value
    function token0() external view returns (address);

    /// @notice Address of token in the poool with the higher address value
    function token1() external view returns (address);

    /// @notice Amount of token0 in pool
    function reserve0() external view returns (uint256);

    /// @notice Amount of token1 in pool
    function reserve1() external view returns (uint256);

    function stable() external view returns (bool);

    function mint(address to) external returns (uint256 liquidity);

    /// @notice Update reserves and, on the first call per block, price accumulators
    /// @return _reserve0 .
    /// @return _reserve1 .
    /// @return _blockTimestampLast .
    function getReserves()
        external
        view
        returns (
            uint256 _reserve0,
            uint256 _reserve1,
            uint256 _blockTimestampLast
        );
}
