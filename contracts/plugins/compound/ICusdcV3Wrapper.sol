// SPDX-License-Identifier: ISC
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IComet {
    function targetReserves() external view returns (uint256);

    function getReserves() external view returns (int256);
}

interface ICusdcV3Wrapper is IERC20, IERC20Metadata {
    function exchangeRate() external view returns (uint256);

    function claimTo(address src, address to) external;

    function underlying() external returns (address);

    function underlyingComet() external returns (IComet);

    function targetReserves() external view returns (uint256);

    function getReserves() external view returns (int256);
}
