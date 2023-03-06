// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// External Interface for RETH
// See: https://github.com/rocket-pool/rocketpool/blob/master/contracts/interface/token/RocketTokenRETHInterface.sol
interface IReth is IERC20 {
    function getEthValue(uint256 _rethAmount) external view returns (uint256);

    function getRethValue(uint256 _ethAmount) external view returns (uint256);

    function getExchangeRate() external view returns (uint256);

    function getTotalCollateral() external view returns (uint256);

    function getCollateralRate() external view returns (uint256);

    function depositExcess() external payable;

    function depositExcessCollateral() external;

    function mint(uint256 _ethAmount, address _to) external;

    function burn(uint256 _rethAmount) external;
}
