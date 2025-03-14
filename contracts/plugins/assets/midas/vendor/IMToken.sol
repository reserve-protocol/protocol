// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/access/IAccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

/**
 * @title IMToken
 * @notice Interface for a Midas token (e.g., mTBILL, mBASIS, mBTC)
 */
interface IMToken is IERC20Upgradeable {
    /**
     * @notice Returns the MidasAccessControl contract used by this token
     * @return The IAccessControlUpgradeable contract instance
     */
    function accessControl() external view returns (IAccessControlUpgradeable);

    /**
     * @notice Returns the pause operator role for mTBILL tokens
     * @return The bytes32 role for mTBILL pause operator
     */
    // solhint-disable-next-line func-name-mixedcase
    function M_TBILL_PAUSE_OPERATOR_ROLE() external view returns (bytes32);

    /**
     * @notice Returns the pause operator role for mBTC tokens
     * @return The bytes32 role for mBTC pause operator
     */
    // solhint-disable-next-line func-name-mixedcase
    function M_BTC_PAUSE_OPERATOR_ROLE() external view returns (bytes32);

    /**
     * @notice puts mTBILL token on pause.
     * should be called only from permissioned actor
     */
    function pause() external;

    /**
     * @notice puts mTBILL token on pause.
     * should be called only from permissioned actor
     */
    function unpause() external;

    /**
     * @dev Returns true if the contract is paused, and false otherwise.
     */
    function paused() external view returns (bool);
}
