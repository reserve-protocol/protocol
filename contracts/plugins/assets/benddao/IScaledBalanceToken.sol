// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.4;

interface IScaledBalanceToken {
    /**
     * @dev Returns the scaled balance of the user and the scaled total supply.
     * @param _user The address of the user
     * @return The scaled balance of the user
     * @return The scaled balance and the scaled total supply
     **/
    function getScaledUserBalanceAndSupply(address _user)
        external
        view
        returns (uint256, uint256);

    /**
     * @dev Returns the scaled total supply of the token. Represents sum(debt/index)
     * @return The scaled total supply
     **/
    function scaledTotalSupply() external view returns (uint256);
}
