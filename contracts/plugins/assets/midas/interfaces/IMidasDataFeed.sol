// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

interface IMidasDataFeed {
    /**
     * @notice Fetches the answer from the underlying aggregator and converts it to base18 precision
     * @return answer The fetched aggregator answer, scaled to 1e18
     */
    function getDataInBase18() external view returns (uint256 answer);

    /**
     * @notice Returns the role identifier for the feed administrator
     * @return The bytes32 role of the feed admin
     */
    function feedAdminRole() external view returns (bytes32);
}
