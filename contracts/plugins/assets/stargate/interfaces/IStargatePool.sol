// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IStargatePool is IERC20Metadata {
    function router() external view returns (address);

    function poolId() external view returns (uint256);

    function totalLiquidity() external view returns (uint256);

    function mint(address _to, uint256 _amountLD) external returns (uint256);

    function amountLPtoLD(uint256 _amountLP) external view returns (uint256);
}
