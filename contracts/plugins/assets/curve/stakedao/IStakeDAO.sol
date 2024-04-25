// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IStakeDAOGauge is IERC20Metadata {
    function deposit(uint256 amount) external;

    function claimer() external view returns (IStakeDAOClaimer);

    // solhint-disable-next-line func-name-mixedcase
    function reward_count() external view returns (uint256);

    // solhint-disable-next-line func-name-mixedcase
    function reward_tokens(uint256 index) external view returns (IERC20Metadata);
}

interface IStakeDAOClaimer {
    function claimRewards(address[] memory gauges, bool claimVeSDT) external;
}
