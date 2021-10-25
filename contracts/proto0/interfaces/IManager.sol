// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

interface IManager {
    function issue(uint256 amount) external;

    function redeem(uint256 amount) external;

    function poke() external;

    function detectDefault() external;

    function pause() external;

    function unpause() external;

    function quoteIssue(uint256 amount) external view returns (uint256[] memory);

    function quoteRedeem(uint256 amount) external view returns (uint256[] memory);

    function fullyCapitalized() external view returns (bool);

    function paused() external view returns (bool);
}
